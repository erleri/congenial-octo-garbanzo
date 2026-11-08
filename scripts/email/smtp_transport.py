"""One recipient, one attempt. No debug transcripts or automatic retry."""
import base64
import json
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage


def send_email(request, *, smtp_factory=smtplib.SMTP_SSL, credentials=None):
    phase = "before_data"
    smtp = None
    try:
        username, password = credentials or (
            os.environ.get("SMTP_USERNAME", "").strip(),
            "".join(os.environ.get("SMTP_PASSWORD", "").split()),
        )
        recipient = request["recipient"]
        payload = request["payload"]
        message_id = request["messageId"]
        if not username or not password or re.search(r"[\r\n]", username):
            raise ValueError("credentials_missing")
        if not isinstance(recipient, str) or not re.fullmatch(r"[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+", recipient):
            raise ValueError("recipient_invalid")
        if not re.fullmatch(r"<[a-f0-9]{64}@latamforex\.netlify\.app>", message_id):
            raise ValueError("message_identity_invalid")
        if not isinstance(payload["subject"], str) or re.search(r"[\r\n]", payload["subject"]):
            raise ValueError("subject_invalid")
        chart = None
        if payload.get("version") != "admin-review-email/1":
            chart = base64.b64decode(request["chartBase64"], validate=True)
            if not chart.startswith(b"\x89PNG\r\n\x1a\n") or len(chart) > 2_000_000:
                raise ValueError("chart_invalid")
        message = EmailMessage()
        message["Subject"] = payload["subject"]
        message["From"] = f"LATAM FX Admin <{username}>"
        message["To"] = recipient
        message["Message-ID"] = message_id
        message.set_content(payload["text"])
        message.add_alternative(payload["html"], subtype="html")
        if chart is not None:
            message.get_payload()[1].add_related(chart, maintype="image", subtype="png",
                                                cid="<fx-chart-image>", filename="email-chart.png")
        smtp = smtp_factory("smtp.gmail.com", 465, timeout=30, context=ssl.create_default_context())
        smtp.login(username, password)
        phase = "dispatch"
        refused = smtp.send_message(message, from_addr=username, to_addrs=[recipient])
        if refused:
            code = int(next(iter(refused.values()))[0])
            return {"status": "rejected", "code": code, "reason": "recipient_rejected"}
        # The server accepted DATA. A later QUIT failure cannot undo that receipt.
        return {"status": "accepted", "code": 250, "reason": "smtp_accepted"}
    except smtplib.SMTPRecipientsRefused as error:
        code = int(next(iter(error.recipients.values()))[0])
        return {"status": "rejected", "code": code, "reason": "recipient_rejected"}
    except smtplib.SMTPDataError as error:
        return {"status": "rejected", "code": error.smtp_code, "reason": "message_rejected"}
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPSenderRefused) as error:
        return {"status": "failed_before_send", "code": error.smtp_code, "reason": "pre_data_failure"}
    except Exception:
        return {"status": "unknown" if phase == "dispatch" else "failed_before_send", "code": None,
                "reason": "transport_result_unknown" if phase == "dispatch" else "pre_data_failure"}
    finally:
        if smtp is not None:
            try:
                smtp.close()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        request_data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
        result = send_email(request_data)
    except Exception:
        result = {"status": "failed_before_send", "code": None, "reason": "pre_data_failure"}
    sys.stdout.write(json.dumps(result))

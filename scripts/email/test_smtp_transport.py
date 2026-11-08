"""SMTP protocol outcomes, with no sockets or real addresses."""
import base64
import smtplib
import unittest
from smtp_transport import send_email


REQUEST = {"recipient": "reader@example.invalid", "messageId": "<" + "a" * 64 + "@latamforex.netlify.app>",
           "payload": {"subject": "Local verification", "text": "Frozen FX", "html": "<p>Frozen FX</p>"},
           "chartBase64": base64.b64encode(b"\x89PNG\r\n\x1a\nsynthetic").decode()}


class FakeSMTP:
    def __init__(self, failure=None, auth_failure=False):
        self.failure = failure
        self.auth_failure = auth_failure
        self.calls = 0
        self.message = None

    def login(self, *_):
        if self.auth_failure:
            raise smtplib.SMTPAuthenticationError(535, b"synthetic")

    def send_message(self, message, **kwargs):
        self.calls += 1
        self.message = message
        assert kwargs["to_addrs"] == [REQUEST["recipient"]]
        if self.failure:
            raise self.failure
        return {}

    def close(self):
        raise OSError("close after receipt must not change acceptance")


class SMTPOutcomes(unittest.TestCase):
    def test_admin_review_digest_has_no_chart_dependency(self):
        request = {**REQUEST, "payload": {**REQUEST["payload"], "version": "admin-review-email/1"}}
        request.pop("chartBase64")
        smtp = FakeSMTP()
        result = send_email(request, smtp_factory=lambda *_args, **kwargs: smtp,
                            credentials=("sender@example.invalid", "synthetic-password"))
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(list(smtp.message.walk())), 3)

    def call(self, fake):
        return send_email(REQUEST, smtp_factory=lambda *_args, **kwargs: fake,
                          credentials=("sender@example.invalid", "synthetic-password"))

    def test_accepted_is_server_receipt_even_if_close_fails(self):
        smtp = FakeSMTP()
        self.assertEqual(self.call(smtp), {"status": "accepted", "code": 250, "reason": "smtp_accepted"})
        self.assertEqual(smtp.calls, 1)
        self.assertEqual(smtp.message["Message-ID"], REQUEST["messageId"])
        self.assertEqual(smtp.message["To"], REQUEST["recipient"])
        self.assertIn("Frozen FX", smtp.message.get_body(preferencelist=("plain",)).get_content())
        self.assertEqual(len(list(smtp.message.iter_attachments())), 0)

    def test_550_is_known_recipient_rejection(self):
        result = self.call(FakeSMTP(smtplib.SMTPRecipientsRefused({REQUEST["recipient"]: (550, b"no user")})))
        self.assertEqual(result, {"status": "rejected", "code": 550, "reason": "recipient_rejected"})

    def test_auth_failure_proves_no_message_dispatch(self):
        smtp = FakeSMTP(auth_failure=True)
        self.assertEqual(self.call(smtp)["status"], "failed_before_send")
        self.assertEqual(smtp.calls, 0)

    def test_explicit_data_rejection_is_not_unknown(self):
        self.assertEqual(self.call(FakeSMTP(smtplib.SMTPDataError(554, b"refused"))),
                         {"status": "rejected", "code": 554, "reason": "message_rejected"})

    def test_disconnect_during_data_is_uncertain_and_not_retried(self):
        smtp = FakeSMTP(smtplib.SMTPServerDisconnected("synthetic lost acknowledgement"))
        self.assertEqual(self.call(smtp), {"status": "unknown", "code": None, "reason": "transport_result_unknown"})
        self.assertEqual(smtp.calls, 1)


if __name__ == "__main__":
    unittest.main()

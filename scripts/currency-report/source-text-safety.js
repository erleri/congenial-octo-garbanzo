// Bounded lexical guards for untrusted source text. In particular, an
// unbounded [word]+@ pattern rescans a long non-email token quadratically.
// These checks identify content to hold; they never execute source instructions.
const email=/(?:^|[^\w.+-])[\w.+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,63}(?![a-z])/i
const other=/sk-or-|bearer\s+\S+|-----BEGIN [^\r\n]{0,100}PRIVATE KEY|<[^>\r\n]{1,500}>|ignore\s+(previous|all)|system\s*prompt|지시[^\r\n]{0,100}무시|[?&](?:token|apikey|api_key)=/i
export const unsafeSourceText=text=>email.test(text)||other.test(text)

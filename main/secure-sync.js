// A local certificate pinned by the phone's QR scan. No public CA or global trust changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

async function identity(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'identity.json');
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Secure pairing identity is damaged. Restore it before pairing again.'); }
  if (!saved) {
    const password = crypto.randomBytes(32).toString('hex');
    const temp = path.join(dir, crypto.randomUUID() + '.pfx');
    const script = `$ErrorActionPreference='Stop'
$rsa=[System.Security.Cryptography.RSA]::Create(2048)
$request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Notebook',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$cert=$request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1),[DateTimeOffset]::Now.AddYears(10))
try {
  [IO.File]::WriteAllBytes($env:NB_CERT_FILE,$cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$env:NB_CERT_PASS))
  [Console]::Write([Convert]::ToBase64String($cert.RawData))
} finally { $cert.Dispose(); $rsa.Dispose() }`;
    try {
      const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 60000, env: { ...process.env, NB_CERT_PASS: password, NB_CERT_FILE: temp } });
      saved = { pfx: fs.readFileSync(temp).toString('base64'), password, cert: stdout.trim() };
      fs.writeFileSync(file + '.tmp', JSON.stringify(saved), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    } finally { fs.rmSync(temp, { force: true }); }
  }
  const cert = new crypto.X509Certificate(Buffer.from(saved.cert, 'base64'));
  if (Date.parse(cert.validTo) < Date.now()) throw new Error('Secure pairing certificate expired. Re-pairing is required.');
  return { pfx: Buffer.from(saved.pfx, 'base64'), passphrase: saved.password,
    fingerprint: crypto.createHash('sha256').update(cert.raw).digest('hex') };
}
module.exports = { identity };

package com.mani.notebook;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

// Trust exactly the certificate scanned from this PC, never discovery or a global trust-all policy.
final class PairedHttp {
    static HttpURLConnection open(String url, String pin) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (pin != null && !pin.isEmpty()) {
            if (!(c instanceof HttpsURLConnection) || !pin.matches("[0-9a-f]{64}")) throw new IOException("Secure connection required. Scan the PC code again.");
            try {
                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, new TrustManager[]{new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException("Not a client trust store"); }
                    public void checkServerTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                        if (chain.length == 0 || !matches(chain[0], pin)) throw new java.security.cert.CertificateException("This is not your paired PC");
                        chain[0].checkValidity();
                    }
                }}, null);
                HttpsURLConnection h = (HttpsURLConnection)c;
                h.setSSLSocketFactory(ssl.getSocketFactory());
                h.setHostnameVerifier((host, session) -> {
                    try { return matches((X509Certificate)session.getPeerCertificates()[0], pin); } catch (Exception e) { return false; }
                });
            } catch (Exception e) { throw new IOException("Secure pairing failed", e); }
        } else if (c instanceof HttpsURLConnection) throw new IOException("No trusted PC certificate. Scan the PC code again.");
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(4000); c.setReadTimeout(25000);
        return c;
    }
    private static boolean matches(X509Certificate cert, String pin) {
        try {
            byte[] expected = new byte[32];
            for (int i=0; i<32; i++) expected[i]=(byte)Integer.parseInt(pin.substring(i*2, i*2+2),16);
            return MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
        } catch (Exception e) { return false; }
    }
}

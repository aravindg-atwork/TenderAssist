// Where TenderAssist checks its key, fixed in the build. The URL is the Apps
// Script web app's /exec address (docs/licence-setup.md). build/installer.nsh
// defines the same URL for the installer's key page; a test keeps them equal.

export const LICENCE_SERVER_URL = 'https://script.google.com/macros/s/AKfycbxv6T28eEY342oou_V_f6NyjnKZ4syRmFkceDA3S5hIJ5eTmheP_LXL5OElTCD0QhdI/exec';

/** Verifies the server's signed answers. Its private half lives only in the Apps Script. */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtoF2IkWYmVqwbO/lpv86
SV1rty7sQ4ZFPg/8pc/i4EZber1FMSroHBXT5Km0Y6p1fT45bnWGOFSZ2cm8q88y
65+ZK8xk5jTEFn5kkIsyoNYzk0BtIKK/D2ySZGhrsBMaWihKTPYTbFaI6NLmji5r
htZyiXPRpsPTRukyz5M8gX9vzNMaJZFd3P3rJ415bgG3lf3FLuBs7eHa9vyuEeTA
34iTpAS3gQ7drtQJCbok5yLOTMuRQoYDaP+Hk8wU1f43hb+SOBDk3LxeSSmF7ZCF
QU3YMlcT42N5bmnw68zpUC/YnU01xCEXjgWSbmxCJ9mXHxcnjPDnBSmFOJ9yYzzs
GQIDAQAB
-----END PUBLIC KEY-----
`;

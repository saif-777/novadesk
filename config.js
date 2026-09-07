/* Paste your Google OAuth Client ID between the quotes.
   Get one free: Google Cloud Console -> APIs & Services -> Credentials
   -> Create Credentials -> OAuth client ID (Web application).
   Add your site origin (e.g. https://saif-777.github.io) to Authorized origins.
   Drive sync uses the SAME client (scope is requested in code, no extra setup).
   On the OAuth consent screen, add your Gmail as a test user. */
window.NOVA = {
  GOOGLE_CLIENT_ID: "695113415507-1fl9vjq82eno99i05nu74110714h59kq.apps.googleusercontent.com",
  /* DESKTOP app login (Electron EXE). Google blocks sign-in inside the app's
     embedded browser, so the EXE signs in via your real browser instead.
     That needs a DESKTOP-type client (Web type won't work):
       Google Cloud Console -> APIs & Services -> Credentials
       -> Create Credentials -> OAuth client ID -> "Desktop app".
     Paste that client ID below. Leave empty = desktop offers demo mode only.
     (Web version keeps using GOOGLE_CLIENT_ID above — don't touch it.) */
  GOOGLE_DESKTOP_CLIENT_ID: ""
};

# Browser test identity safety

This is a permanent rule for anyone - human or AI agent - doing
live/manual browser testing against this project's Supabase backend
(shared browser or otherwise). It exists because of a real incident: an
agent testing the Phase D WhatsApp Inbox navigated to `/login` while the
developer's real session was still active, and the app's authenticated
redirect meant every subsequent "test" action actually ran against the
developer's real account, creating a stray workspace under it.

## The rule

Never assume the currently authenticated browser session belongs to a
disposable test user. Before any browser-based test that may create,
update, or delete data:

1. Determine the currently authenticated identity (check the account
   menu / profile, not just the URL you intended to navigate to).
2. Verify that identity is the expected disposable test identity - not
   a real user's email, not a name you don't recognize as the throwaway
   account you created for this session.
3. Verify the active workspace is the expected disposable test
   workspace - not a real workspace ("Acapolite", a client name, or
   anything you didn't create for this test).
4. If either check fails, stop before performing any mutation. Report
   what you observed and ask before continuing.
5. Never create a test workspace under an existing real user's account
   merely because that session happened to already be authenticated.
6. Prefer explicitly signing out and authenticating as the intended
   disposable test user before starting live browser testing, rather
   than trusting whatever session the browser already has open.
7. Never delete or modify real-user resources during cleanup unless the
   developer explicitly approves the exact operation (exact record,
   exact scope - not "clean up test data" as a blanket instruction).

## Why this matters

A shared browser can carry a real, already-authenticated session across
tabs and across time. Navigating to a login page does not guarantee a
clean slate - if a valid session cookie already exists, the app may
redirect straight past the login form using that real identity. The
failure mode is silent: nothing looks wrong until you check *whose*
account you're actually looking at.

## How to apply

- At the start of any live browser test session: check the account
  menu / profile indicator first, before doing anything else.
- If the session doesn't match the disposable test identity you
  expect, sign out and sign in as the disposable test user explicitly.
- Treat "I'm not sure which account this is" as a stop condition, not
  something to proceed past and check later.
- When cleanup is needed, scope every delete precisely (exact owner
  email + exact resource name/id) and get explicit approval for that
  exact operation before running it - never a broad "delete all my test
  stuff" cleanup.

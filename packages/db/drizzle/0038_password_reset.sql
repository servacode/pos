-- «نسيت كلمة السر»: a code sent to the owner's phone proves it, then the password is replaced and
-- every session of that user is ended. Same challenge table and functions as sign-up.
ALTER TYPE "otp_purpose" ADD VALUE IF NOT EXISTS 'password_reset';

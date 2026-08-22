(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("googleSignIn");
    const label = document.getElementById("googleSignInLabel");
    const status = document.getElementById("status");
    if (!button || !label) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      label.textContent = "Opening Google…";
      if (status) {
        status.textContent = "Complete sign-in in the Google window. This extension popup may close while you sign in.";
      }

      try {
        const response = await chrome.runtime.sendMessage({ type: "CUSTOMER_GOOGLE_SIGN_IN" });
        if (!response?.ok) {
          throw new Error(response?.error || "Google sign-in failed.");
        }
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error?.message || "Google sign-in failed.";
      } finally {
        button.disabled = false;
        label.textContent = "Continue with Google";
      }
    });
  });
})();

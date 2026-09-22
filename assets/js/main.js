/* The two "soon" buttons. They are deliberately inert: there is nothing to sign up
   for yet, so they say so rather than leading somewhere empty. */
(function () {
  "use strict";

  var messages = {
    get: "Not released yet. This page will carry the download when it is.",
    register: "Accounts are not open yet.",
    register2: "Accounts are not open yet."
  };

  function attach(buttonId, noteId) {
    var button = document.getElementById(buttonId);
    var note = document.getElementById(noteId);
    if (!button || !note) return;

    button.addEventListener("click", function () {
      note.textContent = messages[buttonId];
      note.hidden = false;
    });
  }

  attach("get", "note");
  attach("register", "note");
  attach("register2", "note2");
}());

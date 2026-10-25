/* Where the replay page (app/watch, public/js/replay-player.js) gets its matches: the base address of the
   server's public replay API, https only, no trailing slash. The page asks it for
   <address>/api/matches and <address>/api/matches/<id>/replay.

   Empty: the page says the list is not connected yet. To set it, publish the API over https
   (native-port/docs/WEB_BUILD.md, "Putting the API on the web") and write its address here, for example
   window.REPLAY_API = 'https://replays.example.com';

   This file belongs to the website; publish-web-to-site.sh never overwrites it. */
window.REPLAY_API = '';

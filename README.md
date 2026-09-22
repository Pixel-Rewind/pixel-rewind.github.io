# Pixel Rewind Player — website

The marketing and legal site for Pixel Rewind Player, built as plain static files for
GitHub Pages. No build step, no framework, no dependencies.

```
index.html          home
terms.html          terms of use
privacy.html        privacy policy
assets/css/         one stylesheet
assets/js/          one small script (the two "soon" buttons)
assets/img/         logo, favicon, screenshots used on the page
screenshots/        the original phone captures the page images were cut from
.nojekyll           serve the files as-is, no Jekyll processing
```

## Before this goes live

**The repository has to be renamed.** The pages declare their canonical URLs as
`https://pixel-rewind.github.io/…`, which is the address of an *organisation* Pages site.
GitHub only serves that from a repository named after the organisation. This repository is
currently `Pixel-Rewind/player`, which publishes to `https://pixel-rewind.github.io/player/`
instead.

Rename it to **`pixel-rewind.github.io`** (Settings → General → Repository name) and the
stated URLs become correct. If you would rather keep the name `player`, say so — the
`<link rel="canonical">` tags and the `og:` URLs in all three pages need the `/player/`
prefix added, and the Play Console privacy-policy URL has to match exactly or review fails.

Everything else is done. Contact is `support@jubinganga.com` on both legal pages, and the
governing law is the Netherlands.

## The legal section in terms.html

Clause 3, "The legal footing, and its limits", and clause 11, governing law (Netherlands),
were written against primary sources rather than summaries. Every provision cited was
checked:

| Cited | What it says | Checked against |
|---|---|---|
| Auteurswet art. 45j | Lawful acquirer may reproduce as necessary for intended use; loading, displaying and error correction cannot be prohibited by contract | statutory text |
| Auteurswet art. 45k | Lawful user may make a back-up where necessary for the intended use | statutory text |
| Auteurswet art. 45m | Decompilation permitted where indispensable for interoperability of an independently created program | statutory text |
| Auteurswet art. 45n | Disapplies arts. 16b and 16c — **there is no thuiskopie right for software** | statutory text |
| Directive 2009/24/EC arts. 1(2), 5(2), 6 | Ideas/principles unprotected; back-up right cannot be contracted away; decompilation | directive |
| CJEU C-355/12 *Nintendo v PC Box* | A videogame is complex matter, not solely a computer program | judgment |
| CJEU C-435/12 *ACI Adam* | Private-copy exception does not cover unlawful sources | judgment |

The section deliberately states the **limits** as prominently as the permissions. It is not
legal advice and says so; a Dutch IT lawyer should review it before the store submission if
the project ever takes money.

## Local preview

```bash
python3 -m http.server 8000
# then open http://127.0.0.1:8000/
```

## Deploying

Published at **https://pixel-rewind.github.io/** (see the rename note above). Push to the
default branch and enable GitHub Pages for it: Settings → Pages → Deploy from a branch →
`main` / root. `.nojekyll` keeps the files served as written.

The canonical and Open Graph URLs are absolute and hard-coded in the three HTML files; if
the address ever changes, grep for `pixel-rewind.github.io` and update all of them together.

## Images

`assets/img/logo.png` is the app's own logo, cut out of a device screenshot and keyed onto
transparency. The page screenshots are cropped from the captures in `screenshots/` — phone
status and navigation bars trimmed, then scaled to 540px wide. The three game screenshots
are cut to one height so the cards line up.

The games shown are the project's own freely redistributable samples. Cloud Hop and
Starfall use Kenney's CC0 artwork; Relic Rush uses Super Retro World artwork by Gif,
Noiracide and Romi, credited on the page. No copyrighted game content appears anywhere
on the site.

## A note on the copy

The site deliberately describes Pixel Rewind as a *player* that ships no game, and points
at the free sample games rather than any commercial title. The privacy policy's claims —
one Android permission, zero third-party SDKs, no analytics — are true of the app as built
and should be re-checked if that ever changes.

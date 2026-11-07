# gopeed-extension-getcomics

A [Gopeed](https://github.com/GopeedLab/gopeed) extension for [GetComics](https://getcomics.org).

- **Main Server links** (`getcomics.org/dls/...`): follows the redirects to the real file, so the task gets the comic's real name instead of the link token.
- **Post pages** (`getcomics.org/<category>/<post>`): finds the download buttons and picks a host in the configured order (Main Server, then Pixeldrain, then Mediafire). With several links of that host on the page, all of them are added as one task (setting `allLinks`).
- Mega is not supported.

## Install
Gopeed → Extensions → Install → `https://github.com/dvoin3scu/gopeed-extension-getcomics`

## Settings
| Setting | Default | |
|---|---|---|
| `order` | `main,pixeldrain,mediafire` | Host preference for post pages |
| `allLinks` | `true` | Add every link of the chosen host (off = first only) |

## Notes
The page parsing relies on GetComics' button titles and labels (`DOWNLOAD NOW` / `Main Server`, `PIXELDRAIN`, `MEDIAFIRE`). If GetComics changes its markup, `findLinks` / `classify` in `index.js` are the places to adjust.

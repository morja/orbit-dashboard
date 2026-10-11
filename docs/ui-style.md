# UI consistency

Use the existing Orbit components rather than introducing a separate visual style
for a new view. Keep light/dark palettes, density and global text scaling intact.

| Role | CSS token | Size at 100% text scale |
| --- | --- | --- |
| Card heading | `--font-card-title` | 15 px |
| Body / primary list text | `--font-body` | 12 px |
| Secondary text / descriptions | `--font-secondary` | 11 px |
| Caption / small metadata | `--font-caption` | 10 px |
| Dense table metadata | `--font-micro` | 9 px |
| Dialog heading | `--font-dialog-title` | 23 px |

These sizes use rem and respond together to the app's font-size and zoom settings.
Do not hardcode a different size for the same role in another view. Large numeric
metrics, page headings and compact previews have separate roles; they are not card
body text. Add a named token before introducing a new shared typography role.

Cards use `panel` and `section-heading`. Sidebar cards use the same heading size
as main-view cards. Primary list text uses weight 550; secondary text uses muted
color. Favorite services reuse the attention-row structure, with a service icon,
primary label, secondary status and trailing details arrow. Long identifiers wrap
inside their own row without increasing the role's font size.

Use color, spacing, border and shadow tokens. Navigation destinations use distinct
icons: the gear belongs to Settings, the activity line to attention, the server stack to Servers, the cube to Docker & DDEV, and a play symbol
in a circle to Local Services. Keep icon stroke width and dimensions consistent.

Review Overview, Projects, Servers, Docker & DDEV, Storage, Local Services and
Settings after shared CSS changes, in light/dark appearance and a narrow viewport.
Check comparable headings and list text through computed styles, not screenshots
alone. Dialogs and hover previews must remain within the viewport at increased zoom.

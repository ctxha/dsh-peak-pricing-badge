# Peak pricing badge

A DeepSeek Harness Web UI plugin that shows whether DeepSeek API usage is currently billed at **peak** or **off-peak** rates, right below the message composer.

```
● Off-peak  holiday  3d 5h until peak
```

Click the badge to expand the full schedule in your own local time.

## What it shows

| State | Colour | Meaning |
| --- | --- | --- |
| Peak rate | amber | Bills at the full rate |
| Off-peak | green | Bills at half the peak rate |

The badge also counts down to the next switch, so you can tell at a glance whether it is worth waiting ten minutes before firing off a large request.

## Pricing rule

Per the [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/):

> Peak hours are **01:00 – 04:00** and **06:00 – 10:00 UTC, Monday through Friday**, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.

Off-peak rates are exactly half of the peak rates.

At UTC+8 that is **09:00 – 12:00** and **14:00 – 18:00** Beijing time. The detail panel converts the windows into whatever timezone the browser reports.

## Holiday calendar

Weekend detection needs no data. Chinese public holidays do, so the plugin carries a built-in calendar and keeps it in sync online:

1. **Built-in fallback** — 2026 and 2027 dates from the State Council notices, usable offline.
2. **Online sync** — on page load it fetches the current and next year from [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn), which republishes the State Council notice as JSON.
3. **Cache** — successful syncs are stored in `localStorage` for 7 days, so the network is touched rarely.
4. **Silent degradation** — if every mirror fails, it falls back to the cache and then to the built-in table. It never blocks rendering.

Mirrors are tried in order:

```
cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json
raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json
gh-proxy.com/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json
```

The detail panel states which calendar is in use — `synced from holiday-cn` or `built in` — so you always know whether the data is live.

### Make-up workdays

Make-up workdays (`isOffDay: false` in the calendar data) are ignored on purpose. Every one of them falls on a Saturday or Sunday, and weekends are already off-peak in full under the official rule, so treating them as peak days would be wrong.

## Install

The plugin targets the DeepSeek Harness desktop profile. Install it as a local bundle:

```bash
dsh --profile <profile> plugin install /absolute/path/to/dsh-peak-pricing-badge
```

Or let the agent do it: install the directory through the Harness plugin manager's bundle installer. The bundle patch inserts one Host row; the Client half registers itself into `conversation.composer.dock`.

Reload the page after installing. Replacing an already-installed copy needs an app restart so the browser picks up a fresh module generation.

## Layout

| File | Role |
| --- | --- |
| `package.json` | Manifest: bundle patch, client entry point, locale and icon exports |
| `cordis.patch.yml` | Inserts the plugin row into the profile |
| `index.js` | Host half — deliberately empty, the Client owns the rendering |
| `client.js` | Peak classification, countdown, calendar sync, and the React badge |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `icon.svg` | Original artwork |

## Styling

Only Harness theme tokens are used, so the badge follows the active light or dark theme:

- `--dsw-alias-state-warn-primary` — peak
- `--dsw-alias-state-success-primary` — off-peak
- `--dsw-alias-border-l1`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-label-secondary`

No other plugin's DOM, stylesheet, or component internals are read.

## Notes

- The peak windows sit at 09:00 – 18:00 Beijing time, so the UTC calendar date and the Chinese calendar date always agree for these hours. Holiday lookup therefore uses the UTC date key directly.
- Rate classification is computed against the browser clock at one-second resolution.
- Chinese public holidays are the only vendor-specific calendar input; if DeepSeek changes the pricing schedule, update `PEAK_WINDOWS` in `client.js`.

## License

MIT — see [LICENSE](LICENSE).

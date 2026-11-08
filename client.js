window.__ModuleLoader__.load({
  id: '@local/peak-pricing-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'peakPricing';

    // DeepSeek bills peak rates 01:00-04:00 and 06:00-10:00 UTC, Monday to
    // Friday, excluding Chinese public holidays. Every other hour is off-peak,
    // and off-peak bills at half the peak rate.
    // Source: https://api-docs.deepseek.com/quick_start/pricing/
    const PEAK_WINDOWS = [[60, 240], [360, 600]];
    const MINUTE = 60000;

    // Built-in fallback, used until the online calendar arrives.
    // 2026: State Council notice of 2025-11-04 (People's Daily 2025-11-05 p.4).
    // 2027: State Council notice of 2026-11-05.
    const FALLBACK_RANGES = [
      ['2026-01-01', '2026-01-03'], // 元旦
      ['2026-02-15', '2026-02-23'], // 春节
      ['2026-04-04', '2026-04-06'], // 清明节
      ['2026-05-01', '2026-05-05'], // 劳动节
      ['2026-06-19', '2026-06-21'], // 端午节
      ['2026-09-25', '2026-09-27'], // 中秋节
      ['2026-10-01', '2026-10-07'], // 国庆节
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07'],
    ];

    // holiday-cn republishes the State Council notice as JSON. Entries carry
    // `isOffDay`; false marks a make-up workday, which stays off-peak anyway
    // because those always land on a weekend.
    const CALENDAR_HOSTS = [
      (year) => 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + year + '.json',
      (year) => 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/' + year + '.json',
      (year) => 'https://gh-proxy.com/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/' + year + '.json',
    ];
    const CACHE_KEY = '@local/peak-pricing-badge:holidays:v1';
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    function expandRanges(ranges) {
      const days = new Set();
      for (let i = 0; i < ranges.length; i += 1) {
        let cursor = new Date(ranges[i][0] + 'T00:00:00Z');
        const last = new Date(ranges[i][1] + 'T00:00:00Z');
        while (cursor.getTime() <= last.getTime()) {
          days.add(cursor.toISOString().slice(0, 10));
          cursor = new Date(cursor.getTime() + 86400000);
        }
      }
      return days;
    }

    const FALLBACK_DAYS = expandRanges(FALLBACK_RANGES);
    const FALLBACK_YEARS = Array.from(
      new Set(FALLBACK_RANGES.map((range) => range[0].slice(0, 4))),
    ).sort();

    // ---- live calendar state ----------------------------------------------

    let activeDays = FALLBACK_DAYS;
    let activeYears = FALLBACK_YEARS;
    let activeSource = 'builtin';

    const subscribers = new Set();

    function publish(days, years, source) {
      activeDays = days;
      activeYears = years;
      activeSource = source;
      for (const notify of subscribers) {
        try {
          notify();
        } catch (error) {
          // Never let one subscriber break the others.
        }
      }
    }

    function subscribe(notify) {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    }

    function readCache() {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
        if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
        const days = new Set((parsed.days || []).filter((d) => DATE_RE.test(d)));
        if (days.size === 0) return null;
        return { days, years: parsed.years || [], source: 'online' };
      } catch (error) {
        return null;
      }
    }

    function writeCache(days, years) {
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({
          fetchedAt: Date.now(),
          years,
          days: Array.from(days),
        }));
      } catch (error) {
        // Storage may be full or blocked; the in-memory calendar still works.
      }
    }

    async function fetchYear(year, isCancelled) {
      for (const build of CALENDAR_HOSTS) {
        if (isCancelled()) return null;
        try {
          const response = await fetch(build(year), { cache: 'no-store' });
          if (isCancelled()) return null;
          if (!response.ok) continue;
          const body = await response.json();
          const list = body && Array.isArray(body.days) ? body.days : null;
          if (!list) continue;
          const offDays = list
            .filter((entry) => entry && entry.isOffDay === true && DATE_RE.test(entry.date))
            .map((entry) => entry.date);
          if (offDays.length === 0) continue;
          return { year, days: offDays };
        } catch (error) {
          // Try the next mirror.
        }
      }
      return null;
    }

    async function syncCalendar(isCancelled) {
      const cached = readCache();
      if (cached) {
        publish(cached.days, cached.years, cached.source);
      }

      const thisYear = new Date().getUTCFullYear();
      const wanted = [thisYear, thisYear + 1];
      const results = await Promise.all(wanted.map((year) => fetchYear(year, isCancelled)));
      if (isCancelled()) return;

      const years = [];
      const merged = new Set(FALLBACK_DAYS);
      for (const result of results) {
        if (!result) continue;
        years.push(String(result.year));
        for (const day of result.days) merged.add(day);
      }

      if (years.length === 0) return; // keep cache or built-in

      const span = Array.from(
        new Set([...FALLBACK_YEARS, ...years]),
      ).sort();
      publish(merged, span, 'online');
      writeCache(merged, span);
    }

    // ---- rate classification ---------------------------------------------

    // The peak windows sit at 09:00-18:00 Beijing time, so the UTC calendar
    // date and the Chinese calendar date always agree for these hours.
    function utcDateKey(d) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    function isHoliday(d) {
      return activeDays.has(utcDateKey(d));
    }

    function utcMinuteOfDay(d) {
      return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    }

    function isPeak(d) {
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) return false; // weekends are off-peak in full
      if (isHoliday(d)) return false; // Chinese public holidays are off-peak
      const m = utcMinuteOfDay(d);
      for (let i = 0; i < PEAK_WINDOWS.length; i += 1) {
        if (m >= PEAK_WINDOWS[i][0] && m < PEAK_WINDOWS[i][1]) return true;
      }
      return false;
    }

    function nextSwitch(now) {
      const base = new Date(now.getTime());
      base.setUTCSeconds(0, 0);
      const current = isPeak(base);
      const limit = 8 * 24 * 60;
      for (let i = 1; i <= limit; i += 1) {
        const candidate = new Date(base.getTime() + i * MINUTE);
        if (isPeak(candidate) !== current) {
          return { at: candidate, becomesPeak: isPeak(candidate) };
        }
      }
      return null;
    }

    function formatRemaining(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (days > 0) return days + 'd ' + hours + 'h';
      if (hours > 0) return hours + 'h ' + minutes + 'm';
      if (minutes > 0) return minutes + 'm ' + seconds + 's';
      return seconds + 's';
    }

    const tzOffsetMinutes = -new Date().getTimezoneOffset();

    function toLocalClock(minuteOfDay) {
      let v = minuteOfDay + tzOffsetMinutes;
      let shift = 0;
      while (v < 0) {
        v += 1440;
        shift -= 1;
      }
      while (v >= 1440) {
        v -= 1440;
        shift += 1;
      }
      const hh = String(Math.floor(v / 60)).padStart(2, '0');
      const mm = String(v % 60).padStart(2, '0');
      return { text: hh + ':' + mm, shift };
    }

    function localWindow(startMinute, endMinute) {
      const a = toLocalClock(startMinute);
      const b = toLocalClock(endMinute);
      let text = a.text + '\u2013' + b.text;
      const shift = a.shift !== 0 ? a.shift : b.shift;
      if (shift > 0) text += ' (+' + shift + 'd)';
      if (shift < 0) text += ' (' + shift + 'd)';
      return text;
    }

    const DICTS = {
      en: {
        peak: 'Peak rate',
        offPeak: 'Off-peak',
        holidayTag: 'holiday',
        toPeak: 'until peak',
        toOffPeak: 'until off-peak',
        schedule: 'Peak: 01:00\u201304:00 and 06:00\u201310:00 UTC, Mon\u2013Fri',
        local: 'Your local time: {first} and {second}',
        half: 'Off-peak bills at half the peak rate.',
        holidays: 'Weekends and Chinese public holidays are off-peak in full.',
        coverage: 'Holiday calendar: {years} ({source}).',
        srcBuiltin: 'built in',
        srcOnline: 'synced from holiday-cn',
        collapse: 'Hide pricing details',
        expand: 'Show pricing details',
      },
      zh: {
        peak: '峰价',
        offPeak: '谷价',
        holidayTag: '节假日',
        toPeak: '后转峰价',
        toOffPeak: '后转谷价',
        schedule: '峰价：UTC 01:00\u201304:00、06:00\u201310:00，周一至周五',
        local: '你的本地时间：{first}、{second}',
        half: '谷价按峰价五折计费。',
        holidays: '周末与中国法定节假日全天按谷价。',
        coverage: '节假日表：{years}（{source}）。',
        srcBuiltin: '内置',
        srcOnline: '已从 holiday-cn 同步',
        collapse: '收起价格详情',
        expand: '展开价格详情',
      },
    };
    DICTS['zh-CN'] = DICTS.zh;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = [];
          for (const localeId of Object.keys(DICTS)) {
            disposers.push(ctx.locale.register(NS, localeId, DICTS[localeId]));
          }
          return () => {
            for (const dispose of disposers) dispose();
          };
        });

        ctx.effect(() => {
          let cancelled = false;
          syncCalendar(() => cancelled).catch(() => {});
          return () => {
            cancelled = true;
          };
        });

        const t = ctx.locale.bind(NS);
        const tx = (key, vars) => {
          let text = t(key);
          for (const name of Object.keys(vars)) {
            text = text.split('{' + name + '}').join(vars[name]);
          }
          return text;
        };

        function PeakPricingBadge() {
          const [now, setNow] = React.useState(() => Date.now());
          const [open, setOpen] = React.useState(false);
          const [, refreshCalendar] = React.useReducer((count) => count + 1, 0);

          React.useEffect(() => {
            const id = setInterval(() => setNow(Date.now()), 1000);
            return () => clearInterval(id);
          }, []);

          React.useEffect(() => subscribe(refreshCalendar), []);

          const moment = new Date(now);
          const peak = isPeak(moment);
          const holiday = isHoliday(moment);
          const tone = peak
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-state-success-primary)';
          const label = peak ? t('peak') : t('offPeak');

          const next = nextSwitch(moment);
          const suffix = next
            ? (next.becomesPeak ? t('toPeak') : t('toOffPeak'))
            : '';
          const remaining = next ? formatRemaining(next.at.getTime() - now) : '';

          const firstWindow = localWindow(PEAK_WINDOWS[0][0], PEAK_WINDOWS[0][1]);
          const secondWindow = localWindow(PEAK_WINDOWS[1][0], PEAK_WINDOWS[1][1]);
          const localLine = tx('local', { first: firstWindow, second: secondWindow });
          const coverageLine = tx('coverage', {
            years: activeYears.join('\u2013'),
            source: activeSource === 'online' ? t('srcOnline') : t('srcBuiltin'),
          });

          const titleText = [
            label + (holiday ? ' (' + t('holidayTag') + ')' : ''),
            remaining ? remaining + ' ' + suffix : '',
            t('schedule'),
            localLine,
            t('half'),
            t('holidays'),
            coverageLine,
          ].filter(Boolean).join('\n');

          const toggle = () => setOpen((value) => !value);

          const children = [
            h('span', {
              key: 'dot',
              'aria-hidden': true,
              style: {
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: tone,
                flex: '0 0 auto',
              },
            }),
            h('span', { key: 'label', style: { color: tone, fontWeight: 600 } }, label),
          ];

          if (holiday && !peak) {
            children.push(h('span', {
              key: 'holiday',
              style: { opacity: 0.75 },
            }, t('holidayTag')));
          }

          if (remaining) {
            children.push(h('span', {
              key: 'countdown',
              style: { opacity: 0.85 },
            }, remaining + ' ' + suffix));
          }

          const chip = h('button', {
            type: 'button',
            onClick: toggle,
            title: titleText,
            'aria-expanded': open,
            'aria-label': titleText,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 9px',
              borderRadius: 999,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-secondary)',
              font: 'inherit',
              fontSize: 12,
              lineHeight: 1.5,
              cursor: 'pointer',
              userSelect: 'none',
            },
          }, children);

          const detailLine = (text) => h('div', { style: { lineHeight: 1.6 } }, text);

          const detail = open
            ? h('div', {
              style: {
                marginTop: 6,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 12,
              },
            },
              detailLine(t('schedule')),
              detailLine(localLine),
              detailLine(t('half')),
              detailLine(t('holidays')),
              detailLine(coverageLine),
            )
            : null;

          return h('div', {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 0,
            },
          }, chip, detail);
        }

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'peak-pricing-badge',
          order: 2,
          label: () => t('peak') + ' / ' + t('offPeak'),
        }, PeakPricingBadge));
      },
    };
  },
});

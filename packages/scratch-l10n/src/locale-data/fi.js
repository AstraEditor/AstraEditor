!(function (t, e) {
  'object' == typeof exports && 'undefined' != typeof module
    ? (module.exports = e())
    : 'function' == typeof define && define.amd
      ? define(e)
      : ((t.ReactIntlLocaleData = t.ReactIntlLocaleData || {}), (t.ReactIntlLocaleData.fi = e()));
})(this, function () {
  'use strict';
  return [
    {
      locale: 'fi',
      pluralRuleFunction: function (t, e) {
        var i = !String(t).split('.')[1];
        return e ? 'other' : 1 == t && i ? 'one' : 'other';
      },
      fields: {
        year: {
          displayName: 'vuosi',
          relative: { 0: 'tänä vuonna', 1: 'ensi vuonna', '-1': 'viime vuonna' },
          relativeTime: {
            future: { one: '{0} vuoden päästä', other: '{0} vuoden päästä' },
            past: { one: '{0} vuosi sitten', other: '{0} vuotta sitten' }
          }
        },
        'year-short': {
          displayName: 'v',
          relative: { 0: 'tänä v', 1: 'ensi v', '-1': 'viime v' },
          relativeTime: {
            future: { one: '{0} v päästä', other: '{0} v päästä' },
            past: { one: '{0} v sitten', other: '{0} v sitten' }
          }
        },
        month: {
          displayName: 'kuukausi',
          relative: { 0: 'tässä kuussa', 1: 'ensi kuussa', '-1': 'viime kuussa' },
          relativeTime: {
            future: { one: '{0} kuukauden päästä', other: '{0} kuukauden päästä' },
            past: { one: '{0} kuukausi sitten', other: '{0} kuukautta sitten' }
          }
        },
        'month-short': {
          displayName: 'kk',
          relative: { 0: 'tässä kk', 1: 'ensi kk', '-1': 'viime kk' },
          relativeTime: {
            future: { one: '{0} kk päästä', other: '{0} kk päästä' },
            past: { one: '{0} kk sitten', other: '{0} kk sitten' }
          }
        },
        day: {
          displayName: 'päivä',
          relative: { 0: 'tänään', 1: 'huomenna', 2: 'ylihuomenna', '-2': 'toissa päivänä', '-1': 'eilen' },
          relativeTime: {
            future: { one: '{0} päivän päästä', other: '{0} päivän päästä' },
            past: { one: '{0} päivä sitten', other: '{0} päivää sitten' }
          }
        },
        'day-short': {
          displayName: 'pv',
          relative: { 0: 'tänään', 1: 'huom.', 2: 'ylihuom.', '-2': 'toissap.', '-1': 'eilen' },
          relativeTime: {
            future: { one: '{0} pv päästä', other: '{0} pv päästä' },
            past: { one: '{0} pv sitten', other: '{0} pv sitten' }
          }
        },
        hour: {
          displayName: 'tunti',
          relative: { 0: 'tämän tunnin aikana' },
          relativeTime: {
            future: { one: '{0} tunnin päästä', other: '{0} tunnin päästä' },
            past: { one: '{0} tunti sitten', other: '{0} tuntia sitten' }
          }
        },
        'hour-short': {
          displayName: 't',
          relative: { 0: 'tunnin sisällä' },
          relativeTime: {
            future: { one: '{0} t päästä', other: '{0} t päästä' },
            past: { one: '{0} t sitten', other: '{0} t sitten' }
          }
        },
        minute: {
          displayName: 'minuutti',
          relative: { 0: 'tämän minuutin aikana' },
          relativeTime: {
            future: { one: '{0} minuutin päästä', other: '{0} minuutin päästä' },
            past: { one: '{0} minuutti sitten', other: '{0} minuuttia sitten' }
          }
        },
        'minute-short': {
          displayName: 'min',
          relative: { 0: 'minuutin sisällä' },
          relativeTime: {
            future: { one: '{0} min päästä', other: '{0} min päästä' },
            past: { one: '{0} min sitten', other: '{0} min sitten' }
          }
        },
        second: {
          displayName: 'sekunti',
          relative: { 0: 'nyt' },
          relativeTime: {
            future: { one: '{0} sekunnin päästä', other: '{0} sekunnin päästä' },
            past: { one: '{0} sekunti sitten', other: '{0} sekuntia sitten' }
          }
        },
        'second-short': {
          displayName: 's',
          relative: { 0: 'nyt' },
          relativeTime: {
            future: { one: '{0} s päästä', other: '{0} s päästä' },
            past: { one: '{0} s sitten', other: '{0} s sitten' }
          }
        }
      }
    }
  ];
});

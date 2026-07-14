!(function (e, t) {
  'object' == typeof exports && 'undefined' != typeof module
    ? (module.exports = t())
    : 'function' == typeof define && define.amd
      ? define(t)
      : ((e.ReactIntlLocaleData = e.ReactIntlLocaleData || {}), (e.ReactIntlLocaleData.km = t()));
})(this, function () {
  'use strict';
  return [
    {
      locale: 'km',
      pluralRuleFunction: function (e, t) {
        return 'other';
      },
      fields: {
        year: {
          displayName: 'ឆ្នាំ',
          relative: { 0: 'ឆ្នាំ​នេះ', 1: 'ឆ្នាំ​ក្រោយ', '-1': 'ឆ្នាំ​មុន' },
          relativeTime: { future: { other: '{0} ឆ្នាំទៀត' }, past: { other: '{0} ឆ្នាំ​មុន' } }
        },
        'year-short': {
          displayName: 'ឆ្នាំ',
          relative: { 0: 'ឆ្នាំ​នេះ', 1: 'ឆ្នាំ​ក្រោយ', '-1': 'ឆ្នាំ​មុន' },
          relativeTime: { future: { other: '{0} ឆ្នាំទៀត' }, past: { other: '{0} ឆ្នាំ​មុន' } }
        },
        month: {
          displayName: 'ខែ',
          relative: { 0: 'ខែ​នេះ', 1: 'ខែ​ក្រោយ', '-1': 'ខែ​មុន' },
          relativeTime: { future: { other: '{0} ខែទៀត' }, past: { other: '{0} ខែមុន' } }
        },
        'month-short': {
          displayName: 'ខែ',
          relative: { 0: 'ខែ​នេះ', 1: 'ខែ​ក្រោយ', '-1': 'ខែ​មុន' },
          relativeTime: { future: { other: '{0} ខែទៀត' }, past: { other: '{0} ខែមុន' } }
        },
        day: {
          displayName: 'ថ្ងៃ',
          relative: { 0: 'ថ្ងៃ​នេះ', 1: 'ថ្ងៃ​ស្អែក', 2: '​ខាន​ស្អែក', '-2': 'ម្សិល​ម៉្ងៃ', '-1': 'ម្សិលមិញ' },
          relativeTime: { future: { other: '{0} ថ្ងៃទៀត' }, past: { other: '{0} ថ្ងៃ​មុន' } }
        },
        'day-short': {
          displayName: 'ថ្ងៃ',
          relative: { 0: 'ថ្ងៃ​នេះ', 1: 'ថ្ងៃស្អែក', 2: '​ខាន​ស្អែក', '-2': 'ម្សិល​ម៉្ងៃ', '-1': 'ម្សិលមិញ' },
          relativeTime: { future: { other: '{0} ថ្ងៃទៀត' }, past: { other: '{0} ថ្ងៃ​​មុន' } }
        },
        hour: {
          displayName: 'ម៉ោង',
          relative: { 0: 'ម៉ោងនេះ' },
          relativeTime: { future: { other: 'ក្នុង​រយៈ​ពេល {0} ម៉ោង' }, past: { other: '{0} ម៉ោង​មុន' } }
        },
        'hour-short': {
          displayName: 'ម៉ោង',
          relative: { 0: 'ម៉ោងនេះ' },
          relativeTime: { future: { other: '{0} ម៉ោងទៀត' }, past: { other: '{0} ម៉ោង​មុន' } }
        },
        minute: {
          displayName: 'នាទី',
          relative: { 0: 'នាទីនេះ' },
          relativeTime: { future: { other: '{0} នាទីទៀត' }, past: { other: '{0} នាទី​មុន' } }
        },
        'minute-short': {
          displayName: 'នាទី',
          relative: { 0: 'នាទីនេះ' },
          relativeTime: { future: { other: '{0} នាទីទៀត' }, past: { other: '{0} នាទី​​មុន' } }
        },
        second: {
          displayName: 'វិនាទី',
          relative: { 0: 'ឥឡូវ' },
          relativeTime: { future: { other: '{0} វិនាទីទៀត' }, past: { other: '{0} វិនាទី​មុន' } }
        },
        'second-short': {
          displayName: 'វិនាទី',
          relative: { 0: 'ឥឡូវ' },
          relativeTime: { future: { other: '{0} វិនាទីទៀត' }, past: { other: '{0} វិនាទី​មុន' } }
        }
      }
    }
  ];
});

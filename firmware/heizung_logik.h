// Heizungs-Knopf – reine Logik (Wochenplan, Datum/Zeit-Helfer)
// Wird von heizung.yaml eingebunden. Keine ESPHome-Abhängigkeiten, damit testbar.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>

namespace hz {

static const int MAX_WECHSEL = 6;
static const char *const WT[7] = {"Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"};

struct Wechsel {
  int16_t minute;  // Minuten seit Mitternacht
  int8_t stufe;    // 0 (= Stern) … 7
};
struct Tag {
  Wechsel w[MAX_WECHSEL];
  uint8_t n;
};
static Tag plan[7];  // 0 = Montag … 6 = Sonntag

// ESPHome: day_of_week 1 = Sonntag … 7 = Samstag  ->  0 = Montag … 6 = Sonntag
inline int wtag_mo0(int dow_esphome) { return (dow_esphome + 5) % 7; }

// Text "06:00=5 08:30=2 17:00=5 22:30=1" einlesen (max. 6 Einträge, wird sortiert)
inline void parse_tag(int tag, const std::string &s) {
  if (tag < 0 || tag > 6) return;
  Tag &t = plan[tag];
  t.n = 0;
  const char *p = s.c_str();
  while (*p && t.n < MAX_WECHSEL) {
    while (*p == ' ' || *p == ',' || *p == ';') p++;
    if (!*p) break;
    int h = -1, m = -1, l = -1, used = 0;
    if (sscanf(p, "%d:%d=%d%n", &h, &m, &l, &used) == 3 && h >= 0 && h <= 23 && m >= 0 && m <= 59 && l >= 0 &&
        l <= 7) {
      int16_t minute = (int16_t) (h * 60 + m);
      bool doppelt = false;
      for (int i = 0; i < t.n; i++)
        if (t.w[i].minute == minute) {
          t.w[i].stufe = (int8_t) l;
          doppelt = true;
        }
      if (!doppelt) {
        t.w[t.n].minute = minute;
        t.w[t.n].stufe = (int8_t) l;
        t.n++;
      }
    }
    while (*p && *p != ' ' && *p != ',' && *p != ';') p++;  // zum nächsten Eintrag
  }
  for (int i = 1; i < t.n; i++) {  // Einfügesortierung
    Wechsel x = t.w[i];
    int j = i - 1;
    while (j >= 0 && t.w[j].minute > x.minute) {
      t.w[j + 1] = t.w[j];
      j--;
    }
    t.w[j + 1] = x;
  }
}

inline bool hat_plan() {
  for (int d = 0; d < 7; d++)
    if (plan[d].n > 0) return true;
  return false;
}

// Welche Stufe gilt laut Plan jetzt? (-1 = kein Plan vorhanden)
inline int stufe_um(int tag, int minute) {
  for (int back = 0; back <= 7; back++) {
    int d = ((tag - back) % 7 + 7) % 7;
    const Tag &t = plan[d];
    for (int i = t.n - 1; i >= 0; i--)
      if (back > 0 || t.w[i].minute <= minute) return t.w[i].stufe;
  }
  return -1;
}

// Ist genau jetzt ein Wechsel fällig?
inline bool wechsel_bei(int tag, int minute) {
  const Tag &t = plan[((tag % 7) + 7) % 7];
  for (int i = 0; i < t.n; i++)
    if (t.w[i].minute == minute) return true;
  return false;
}

// Nächster Wechsel nach "jetzt". tage_voraus: 0 = heute, 1 = morgen, …
inline bool naechster(int tag, int minute, int &n_tag, int &n_minute, int &n_stufe, int &tage_voraus) {
  for (int vor = 0; vor <= 7; vor++) {
    int d = (tag + vor) % 7;
    const Tag &t = plan[d];
    for (int i = 0; i < t.n; i++)
      if (vor > 0 || t.w[i].minute > minute) {
        n_tag = d;
        n_minute = t.w[i].minute;
        n_stufe = t.w[i].stufe;
        tage_voraus = vor;
        return true;
      }
  }
  return false;
}

// Urlaubsende: heute + tage, um hh:mm Ortszeit (berücksichtigt Sommer-/Winterzeit)
inline uint32_t urlaub_ende(time_t jetzt, int tage, int hh, int mm) {
  struct tm tmv;
  localtime_r(&jetzt, &tmv);
  tmv.tm_mday += tage;
  tmv.tm_hour = hh;
  tmv.tm_min = mm;
  tmv.tm_sec = 0;
  tmv.tm_isdst = -1;
  return (uint32_t) mktime(&tmv);
}

// Anzahl Kalendertage von jetzt bis ende (0 = heute)
inline int tage_bis(time_t jetzt, time_t ende) {
  if (ende <= jetzt) return 0;
  struct tm a, b;
  localtime_r(&jetzt, &a);
  localtime_r(&ende, &b);
  a.tm_hour = 12; a.tm_min = 0; a.tm_sec = 0; a.tm_isdst = -1;
  b.tm_hour = 12; b.tm_min = 0; b.tm_sec = 0; b.tm_isdst = -1;
  double diff = difftime(mktime(&b), mktime(&a));
  return (int) ((diff + 43200) / 86400);
}

// "Sa 22.11." bzw. "22.11."
inline std::string fmt_datum(time_t t, bool mit_wtag) {
  struct tm v;
  localtime_r(&t, &v);
  char b[20];
  if (mit_wtag)
    snprintf(b, sizeof(b), "%s %02d.%02d.", WT[(v.tm_wday + 6) % 7], v.tm_mday, v.tm_mon + 1);
  else
    snprintf(b, sizeof(b), "%02d.%02d.", v.tm_mday, v.tm_mon + 1);
  return std::string(b);
}

// "23:05"
inline std::string fmt_zeit(time_t t) {
  struct tm v;
  localtime_r(&t, &v);
  char b[8];
  snprintf(b, sizeof(b), "%02d:%02d", v.tm_hour, v.tm_min);
  return std::string(b);
}

}  // namespace hz

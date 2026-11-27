// Heizungs-Knopf – reine Logik (Wochenplan, Datum/Zeit-Helfer, TMC2209-Datagramme)
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

// ---------------------------------------------------------------------
// TMC2209 Eindraht-UART (Datenblatt Kap. 4). Adresse 0, weil MS1 = MS2 = GND.
// ---------------------------------------------------------------------
static const uint8_t TMC_ADR = 0;
static const uint8_t TMC_GCONF = 0x00;
static const uint8_t TMC_IFCNT = 0x02;        // zählt erfolgreiche Schreibzugriffe (8 Bit)
static const uint8_t TMC_IHOLD_IRUN = 0x10;
// GCONF: I_scale_analog = 1 (VREF bleibt Massstab), pdn_disable = 1 (UART statt PDN),
// mstep_reg_select = 0 (Mikroschritt weiter über MS1/MS2 = 1/8), multistep_filt = 1, StealthChop.
static const uint32_t TMC_GCONF_WERT = 0x00000141;

// CRC8 nach Datenblatt (Polynom x^8 + x^2 + x + 1, Bits LSB zuerst)
inline uint8_t tmc_crc(const uint8_t *d, int n) {
  uint8_t crc = 0;
  for (int i = 0; i < n; i++) {
    uint8_t b = d[i];
    for (int j = 0; j < 8; j++) {
      if (((crc >> 7) ^ (b & 0x01)) != 0) crc = (uint8_t) ((crc << 1) ^ 0x07);
      else crc = (uint8_t) (crc << 1);
      b >>= 1;
    }
  }
  return crc;
}

// Schreibzugriff: 8 Byte
inline void tmc_schreibdatagramm(uint8_t out[8], uint8_t reg, uint32_t wert) {
  out[0] = 0x05;
  out[1] = TMC_ADR;
  out[2] = (uint8_t) (reg | 0x80);
  out[3] = (uint8_t) (wert >> 24);
  out[4] = (uint8_t) (wert >> 16);
  out[5] = (uint8_t) (wert >> 8);
  out[6] = (uint8_t) wert;
  out[7] = tmc_crc(out, 7);
}

// Leseanfrage: 4 Byte
inline void tmc_leseanfrage(uint8_t out[4], uint8_t reg) {
  out[0] = 0x05;
  out[1] = TMC_ADR;
  out[2] = (uint8_t) (reg & 0x7F);
  out[3] = tmc_crc(out, 3);
}

// Antwort (8 Byte: 05 FF reg d3 d2 d1 d0 crc) prüfen und Wert auslesen
inline bool tmc_antwort(const uint8_t in[8], uint8_t reg, uint32_t &wert) {
  if (in[0] != 0x05 || in[1] != 0xFF || in[2] != (reg & 0x7F)) return false;
  if (tmc_crc(in, 7) != in[7]) return false;
  wert = ((uint32_t) in[3] << 24) | ((uint32_t) in[4] << 16) | ((uint32_t) in[5] << 8) | in[6];
  return true;
}

// Strom in % (des mit VREF/R9 eingestellten Maximums, ca. 0,7 A) -> Registerwert IHOLD_IRUN.
// IRUN = Strom beim Fahren (0…31, Strom = (IRUN+1)/32), IHOLD = halber Fahrstrom, IHOLDDELAY = 4.
inline uint32_t tmc_ihold_irun(int prozent) {
  if (prozent < 5) prozent = 5;
  if (prozent > 100) prozent = 100;
  int irun = (prozent * 32 + 50) / 100 - 1;
  if (irun < 0) irun = 0;
  if (irun > 31) irun = 31;
  const int ihold = irun / 2;
  return (uint32_t) ihold | ((uint32_t) irun << 8) | (4u << 16);
}

}  // namespace hz

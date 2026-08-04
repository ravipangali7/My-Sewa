export type DateConfig = {
  [year: string]: {
    Baisakh: number;
    Jestha: number;
    Asar: number;
    Shrawan: number;
    Bhadra: number;
    Aswin: number;
    Kartik: number;
    Mangsir: number;
    Poush: number;
    Magh: number;
    Falgun: number;
    Chaitra: number;
  };
};

export declare const dateConfigMap: DateConfig;

export default class NepaliDate {
  static language: "np" | "en";
  constructor(value?: string | number | Date);
  constructor(year: number, monthIndex: number, date: number);
  toJsDate(): Date;
  getDate(): number;
  getYear(): number;
  getDay(): number;
  getMonth(): number;
  static now(): NepaliDate;
  static fromAD(date: Date): NepaliDate;
}

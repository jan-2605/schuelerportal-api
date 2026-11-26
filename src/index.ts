import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { load as cheerioLoad } from "cheerio";
import { JSDOM } from "jsdom";
import { Cookie, CookieJar } from "tough-cookie";

type SchoolInfo = {
  key: string;
  value: string;
};
type Termin = {
  id: number;
  title: string;
  title_short: string;
  class: "event-info";
  bo_end: 0 | 1;
  startDate: Date;
  endDate: Date;
};
export type Schulaufgabe = {
  id: number;
  title: string;
  date: Date;
};
type SchülerPortalApiClientConfig = {
  short: string;
  username: string;
  password: string;
};
type SchwarzesBrettBox = {
  id: number | null;
  archived: Boolean;
  dateStart: string;
  dateEnd: string | null;
  title: string;
  content: string;
  link: string | undefined;
};
export type SchülerportalFile = {
  name: string;
  buffer: Buffer;
};
type Vertretung = {
  date: Date;
  period: number;
  originalTeacher: string;
  substituteTeacher: string;
  originalClass: string;
  substituteClass: string;
  room: string;
  note: string;
};
type VertretungsPlan = {
  lastUpdate: Date|undefined,
  substitutions: Vertretung[]
};
type Stunde = {
  period: number;
  subject: string;
  teacher: string;
  room: string;
};
type Stundenplan = {
  day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  lessons: Stunde[];
};
type Zeittafel = {
  period: number;
  from: string;
  to: string;
}
// =========
/** gives you a new SchülerPortalApiClient instance */
async function getSchülerportalClient(
  config: SchülerPortalApiClientConfig
): Promise<InstanceType<typeof SchülerPortalApiClient>> {
  const apiclient = new SchülerPortalApiClient(config);
  await apiclient.init();
  return apiclient;
}
class SchülerPortalApiClient {
  jar: CookieJar;
  client: AxiosInstance;
  short: string = "";
  username: string = "";
  password: string = "";
  csrf: string = "";
  
  constructor(config: SchülerPortalApiClientConfig) {
    this.short = config.short;
    this.username = config.username;
    this.password = config.password;
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({ jar: this.jar, withCredentials: true, } as any) as any) as AxiosInstance;
  }
  async init() {
    const { data } = await this.client.request({
      method: "GET",
      url: `https://api.schueler.schule-infoportal.de/${this.short}/api/school`,
    });
    const cookies = await this.jar.getCookies(`https://api.schueler.schule-infoportal.de/${this.short}/api/school`);
    const target = cookies.find(c => c.key === 'XSRF-TOKEN');
    if(target) this.csrf = target.value;
    await this.login();
  }

  async login() {
    const json = JSON.stringify({ email: this.username, password: this.password });
    await this.client.request({
      method: "POST",
      url: `https://api.schueler.schule-infoportal.de/${this.short}/login`,
      headers: {
        "Content-Type": "application/json",
        "X-XSRF-TOKEN": decodeURIComponent(this.csrf),
      },
      data: json,
    });
  }

  /** get school infos as key value json array */
  async getSchoolInfos(): Promise<SchoolInfo[]> {
    const { data } = await this.client.get(
      `https://api.schueler.schule-infoportal.de/${this.short}/api/school`
    );
    const unwantedKeys = ["test_period", "\x00*\x00ignoreMissing","\x00*\x00exceptKeys","\x00*\x00onlyKeys","addres2"];
    const schoolInfos: SchoolInfo[] = Object.entries(data)
      .filter(([key]) => !unwantedKeys.includes(key))
      .map(([key, value]) => ({
        key,
        value: value !== null && value !== undefined ? String(value) : ""
      }));

    return schoolInfos;
  }

  async getStundenplan(): Promise<Stundenplan[]> {
    const url = `https://api.schueler.schule-infoportal.de/${this.short}/api/stundenplan`;
    console.log(await this.jar.getCookieString(url));
    
    const {data} = await this.client.request({
      method: "GET",
      url: `https://api.schueler.schule-infoportal.de/${this.short}/api/stundenplan`,
      headers: {
        Accept: "application/json",
      }

    });
    return data;

  }

  /** get termine of entire school */
  async getTermine(from = 0, to = 0): Promise<Termin[]> {
    const [param__from, param__to, utc_offset] = this.getFromAndToParams(
      from,
      to
    );
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/api/ws_get_termine.php`,
      params: { from: param__from, to: param__to, utc_offset },
    });
    if (data.success === 1) {
      data.result = data.result.map((t: any) => {
        t.title = t.title.replaceAll("<br />", "<br>").replaceAll("<br>", "\n");
        t.title_short = t.title_short
          .replaceAll("<br />", "<br>")
          .replaceAll("<br>", "\n");
        t.startDate = new Date(parseInt(t.start));
        t.endDate = new Date(parseInt(t.end));
        t.bo_end = parseInt(t.bo_end);
        t.id = parseInt(t.id.replace("id_", ""));
        return t;
      });
      data.result = data.result.filter((t: any) => t.start >= param__from);
      data.result = data.result.filter((t: any) => t.end <= param__to);
      return data.result;
    }
    return [];
  }

  async getSchulaufgabenplan(): Promise<Schulaufgabe[]> {
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/service/termine/liste/schulaufgaben#10`,
    });
    const $ = cheerioLoad(data);
    const schulaufgaben: Schulaufgabe[] = [];

    $(".container #asam_content .row .no_padding_md .table2 tbody tr").each(
      (index, element) => {
        const datum = $(element).find("td").eq(0).text().trim();
        const titel = $(element).find("td").eq(2).text().trim();

        if (titel && datum) {
          const schaulaufgabe: Schulaufgabe = {
            id: this.getIdFromTitle(titel),
            title: titel,
            date: this.toDate(datum),
          };
          schulaufgaben.push(schaulaufgabe);
        }
      }
    );
    return schulaufgaben;
  }

  private getFromAndToParams(from = 0, to = 0): [number, number, number] {
    const now = Date.now();
    const utc_offset = new Date().getTimezoneOffset();
    let param__from = from;
    if (param__from === 0) {
      param__from = now;
    }
    let param__to = to;
    if (param__to === 0) {
      param__to = now + 1000 * 60 * 60 * 24 * 90;
    }
    //
    if (`${from}`.length !== 13) {
      param__from = parseInt(`${param__from}`.padEnd(13, "0"));
    }
    if (`${to}`.length !== 13) {
      param__to = parseInt(`${param__to}`.padEnd(13, "0"));
    }

    return [param__from, param__to, utc_offset];
  }

  /** get substitutions */
  async getVertretungsplan(): Promise<VertretungsPlan> {
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/service/vertretungsplan`,
    });
    const $ = cheerioLoad(data);

    const lastUpdate = $('div.main_center div:contains("Stand:")').text();
    const dateTimeMatch = lastUpdate.match(/Stand:\s(\d{2}\.\d{2}\.\d{4})\s(\d{2}:\d{2}:\d{2})/);
    let jsDate : Date|undefined = undefined;
    if (dateTimeMatch) {
      const [_, datePart, timePart] = dateTimeMatch;

      // Convert to a JavaScript Date object
      const [day, month, year] = datePart.split('.').map(Number);
      const [hours, minutes, seconds] = timePart.split(':').map(Number);
      jsDate = new Date(year, month - 1, day, hours, minutes, seconds);
    }


    const vertretungsplan: VertretungsPlan = {
      lastUpdate: jsDate,
      substitutions: []
    };

    $('div.main_center div.list.bold:contains("KW")').each((_index, element) => {
      const $element = $(element);
      const datestring = $element.text();

      const match = datestring.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (!match || match.length != 4) {
        return false;
      }
      const substitutionDate = new Date(+match[3], +match[2] - 1, +match[1]);

      // find matching table
      const table = $element.next();
      if (!table.is("table")) {
          return false;
      }

      // row might contain note about 'Keine Vertretungen'
      if (table.has('tr:nth-child(2) td[align=center]:contains(Keine Vertretungen)').length > 0) {
          return false;
      }

      table.find('tr:not(.vp_plan_head)').each((_index, element) => {
        const $element = $(element);
        vertretungsplan.substitutions.push({
          date: substitutionDate,
          period: Number.parseInt($element.find("td:nth-child(1)").text()),
          originalTeacher: $element.find("td:nth-child(2)").text(),
          substituteTeacher: $element.find("td:nth-child(3)").text(),
          substituteClass: $element.find("td:nth-child(4) span").text().trim(),
          originalClass: $element.find("td:nth-child(4) span").remove().text().trim(),
          room: $element.find("td:nth-child(5)").text(),
          note: $element.find("td:nth-child(6)").text()
        });
      });
    });
    return vertretungsplan;
  }  


  private getIdFromTitle(title: string): number {
    let hash = 5381;
    for (let i = 0; i < title.length; i++) {
      hash = (hash * 33) ^ title.charCodeAt(i); // Multipliziere den Hash und XOR mit dem aktuellen Zeichen
    }
    return hash >>> 0; // Umwandlung in eine positive Ganzzahl
  }

  toDate(dateString: string): Date {
    const [day, month, year] = dateString.split(".").map(Number);
    return new Date(year, month - 1, day);
  }

  // timestamp to date
  timestampToDate(timestamp: number): Date {
    return new Date(timestamp);
  }

  private htmlToPlainText(html: string): string {
    const dom = new JSDOM(html);
    return dom.window.document.body.textContent || "";
  }
}
// =========
export { SchülerPortalApiClient, getSchülerportalClient };

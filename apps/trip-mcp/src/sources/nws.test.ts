import { describe, it } from "vitest";
import * as nws from "./nws.js";

describe("nws source", () => {
  it("module loads", () => {
    void nws.getPoint;
    void nws.getForecast;
    void nws.getHourlyForecast;
    void nws.getActiveAlerts;
    void nws.getAreaForecastDiscussion;
  });

  it.todo("getPoint rounds coordinates to 4 decimals");
  it.todo("getForecast resolves point then fetches forecastUrl");
  it.todo("getActiveAlerts returns empty array when no features");
  it.todo("getAreaForecastDiscussion picks newest product");
});

const { default: PQueue } = require("p-queue");
const { DateTime } = require("luxon");
const _ = require("lodash");
const got = require("got");
const { capitalCase } = require("capital-case");
const logger = require("../logger");
const { Store } = require("../models/Store");

const Cvs = {
  fetchStatus: async () =>
    got(
      "https://www.cvs.com/immunizations/covid-19-vaccine.vaccine-status.json?vaccineinfo",
      {
        headers: {
          "User-Agent":
            "covid-vaccine-finder (https://github.com/GUI/covid-vaccine-finder)",
          Referer: "https://www.cvs.com/immunizations/covid-19-vaccine",
        },
        responseType: "json",
        timeout: 30000,
        retry: 0,
      }
    ),

  refreshStores: async () => {
    logger.notice("Begin refreshing appointments for all stores...");

    const queue = new PQueue({ concurrency: 5 });

    const lastFetched = DateTime.utc().toISO();

    const resp = await Cvs.fetchStatus();
    for (const [stateCode, cities] of Object.entries(
      resp.body.responsePayloadData.data
    )) {
      for (const city of cities) {
        const raw = _.cloneDeep(resp.body);
        raw.responsePayloadData.data = {};
        raw.responsePayloadData.data[stateCode] = [city];
        const patch = {
          brand: "cvs",
          brand_id: `${city.state}-${city.city}`,
          name: `${capitalCase(city.city)}, ${city.state}`,
          city: capitalCase(city.city),
          state: city.state,
          carries_vaccine: true,
          appointments: [],
          appointments_last_fetched: lastFetched,
          appointments_available:
            parseInt(city.totalAvailable, 10) > 0 ||
            city.status !== "Fully Booked",
          appointments_raw: raw,
        };

        queue.add(() =>
          Store.query().insert(patch).onConflict(["brand", "brand_id"]).merge()
        );
      }
    }

    await queue.onIdle();

    logger.notice("Finished refreshing appointments for all stores.");
  },
};

module.exports.refreshCvs = async () => {
  await Cvs.refreshStores();
};

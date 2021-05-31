#!/usr/bin/env node

import {
  CharacteristicType,
  HapClient,
  HapInstance,
  ServiceType,
} from "@oznu/hap-client";

import { Session } from "@inrupt/solid-client-authn-node";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  addDecimal,
  addInteger,
  addStringNoLocale,
  addUrl,
  createSolidDataset,
  createThing,
  getDecimal,
  getInteger,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  saveSolidDatasetAt,
  setThing,
  setUrl,
  UrlString,
} from "@inrupt/solid-client";

import { RDF } from "@inrupt/vocab-common-rdf";

import WebSocket = require("ws");

const IOT = (identifier: string) => `http://dcg.nz/vocab/iot.ttl#${identifier}`;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const argv = yargs(hideBin(process.argv))
  .options({
    idp: {
      type: "string",
      demandOption: true,
      describe: "The url of your solid identity provider.",
    },
    token: {
      type: "string",
      demandOption: true,
      describe: "Token to refresh credentials.",
    },
    id: {
      type: "string",
      demandOption: true,
      describe:
        "An ID for the client, previously registered to the identity provider.",
    },
    secret: {
      type: "string",
      demandOption: true,
      describe:
        "A secret associated with your client ID during client registration to the the identity provider.",
    },
    homeUrl: {
      type: "string",
      demandOption: true,
      describe: "The solid pod url of your home.",
    },
    pin: {
      type: "string",
      demandOption: true,
      describe: "Homekit Pin",
    },
    groupName: {
      type: "string",
      describe: "Name of device group.",
    },
    debug: {
      type: "boolean",
      default: false,
      describe: "Shows debug info",
    },
    verbose: {
      type: "boolean",
      default: false,
      describe: "Verbose logging",
    },
  })
  .config("config")
  .help().argv;

const session = new Session();
const hap = new HapClient({
  pin: argv.pin,
  logger: console,
  config: {
    debug: argv.debug,
  },
});

const characteristics = new Map<string, CharacteristicType>();

function log(
  message: string,
  context: string = "",
  type: "INFO" | "SUCCESS" | "ERROR" = "INFO"
) {
  if (argv.verbose) {
    const out = `${
      type === "ERROR" ? "❌" : type === "INFO" ? "ℹ️ " : "✅"
    }[${context}] ${message}`;
    type == "ERROR" ? console.error(out) : console.log(out);
  }
}

function connectToSolid() {
  log("Connecting to pod...", "solid");
  return session
    .login({
      refreshToken: argv.token,
      clientId: argv.id,
      clientSecret: argv.secret,
      oidcIssuer: argv.idp,
    })
    .then(() => log("Connected to pod!", "solid", "SUCCESS"))
    .catch((err) => log(`Error connecting to pod: ${err}`, "solid", "ERROR"));
}

function syncGroupToSolid(groupName: string, deviceUrls: UrlString[]) {
  let data = createSolidDataset();
  let thing = createThing({ name: groupName.replace(/[^A-Za-z]/g, "") });
  thing = addUrl(thing, RDF.type, IOT("Group"));
  thing = addStringNoLocale(thing, IOT("name"), groupName);
  for (const deviceUrl of deviceUrls) {
    thing = addUrl(thing, IOT("contains"), deviceUrl);
  }
  data = setThing(data, thing);
  const url = `${argv.homeUrl}/Groups/${groupName}`;
  return saveSolidDatasetAt(url, data, { fetch: session.fetch });
}

async function syncDeviceToSolid(device: ServiceType) {
  let data = createSolidDataset();
  let thing = createThing({
    name: `${device.serviceName.replace(/[^A-Za-z]/g, "")}${device.aid}`,
  });
  thing = addUrl(thing, RDF.type, IOT("Device"));
  thing = addStringNoLocale(thing, IOT("name"), device.serviceName);
  thing = addStringNoLocale(thing, IOT("type"), device.type);
  thing = addInteger(thing, IOT("id"), device.aid);
  thing = addStringNoLocale(thing, IOT("uuid"), device.uuid);
  for (const characteristic of device.serviceCharacteristics) {
    const res = await syncCharacteristicToSolid(device, characteristic);
    // link to device
    if (res) {
      thing = addUrl(
        thing,
        IOT("hasCharacteristic"),
        res.internal_resourceInfo.sourceIri
      );
    }
  }
  data = setThing(data, thing);
  const url = `${argv.homeUrl}/Devices/${device.uniqueId}`;
  return saveSolidDatasetAt(url, data, { fetch: session.fetch });
}

async function syncCharacteristicToSolid(
  device: ServiceType,
  characteristic: CharacteristicType
) {
  const url = `${argv.homeUrl}/Characteristics/${device.uniqueId}/${characteristic.type}`;
  const curr = characteristics.get(url);
  if (curr && characteristic.value == curr.value) return;
  let data = createSolidDataset();
  let thing = createThing({
    name: `${characteristic.type.replace(/[^A-Za-z]/g, "")}${
      characteristic.iid
    }`,
  });
  thing = addUrl(thing, RDF.type, IOT("Characteristic"));
  thing = addStringNoLocale(thing, IOT("desc"), characteristic.description);
  thing = addStringNoLocale(thing, IOT("format"), characteristic.format);
  thing = addInteger(thing, IOT("canRead"), +characteristic.canRead);
  thing = addInteger(thing, IOT("canWrite"), +characteristic.canWrite);
  thing = addStringNoLocale(thing, IOT("type"), characteristic.type);
  thing = addInteger(thing, IOT("id"), characteristic.iid);
  thing = addStringNoLocale(thing, IOT("uuid"), characteristic.uuid);
  if (characteristic.unit)
    thing = addStringNoLocale(thing, IOT("unit"), characteristic.unit);
  const { value } = characteristic;
  switch (characteristic.format) {
    case "bool":
      thing = addInteger(
        thing,
        IOT("value"),
        typeof value === "string" ? parseInt(value) : +value
      );
      break;
    case "string":
      thing = addStringNoLocale(thing, IOT("value"), `${value}`);
      break;
    case "float":
      thing = addDecimal(
        thing,
        IOT("value"),
        typeof value === "string" ? parseFloat(value) : +value
      );
      break;
    case "int":
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
      thing = addInteger(
        thing,
        IOT("value"),
        typeof value === "string" ? parseInt(value) : +value
      );
      break;
    default:
      log("Unsupported format", "solid", "ERROR");
  }
  data = setThing(data, thing);
  characteristics.set(url, { ...characteristic });
  return saveSolidDatasetAt(url, data, { fetch: session.fetch });
}

async function monitorHapEvents() {
  const monitor = await hap.monitorCharacteristics();
  monitor.on("service-update", (updates: ServiceType[]) => {
    updates.forEach((update) => {
      update.serviceCharacteristics.forEach((characteristic) =>
        syncCharacteristicToSolid(update, characteristic)
      );
    });
  });
}

function monitorSolidEvents() {
  const socket = new WebSocket(argv.homeUrl.replace("http", "ws"), [
    "solid-0.1",
  ]);
  socket.onopen = function () {
    characteristics.forEach((_, url) => this.send(`sub ${url}`));
  };
  socket.onerror = function (err: WebSocket.ErrorEvent) {
    log(`Websocket error observed: ${err.message}`, "solid", "ERROR");
  };
  socket.onclose = function () {
    log("Websocket is closed now.", "solid", "INFO");
  };
  socket.onmessage = async function (msg: WebSocket.MessageEvent) {
    if (msg.data && msg.data.slice(0, 3) === "pub") {
      // resource updated, refetch resource
      const resourceUrl = msg.data.slice(4).toString();
      const curr = characteristics.get(resourceUrl);
      if (!curr) return;
      const data = await getSolidDataset(resourceUrl, { fetch: session.fetch });

      const thing = getThing(
        data,
        `${resourceUrl}#${curr.type.replace(/[^A-Za-z]/g, "")}${curr.iid}`
      )!;
      const format = getStringNoLocale(thing, IOT("format"));

      // get value in right type
      let value: boolean | number | string | null;
      switch (format) {
        case "bool":
          value = getInteger(thing, IOT("value"));
          break;
        case "string":
          value = getStringNoLocale(thing, IOT("value"));
          break;
        case "float":
          value = getDecimal(thing, IOT("value"));
          break;
        case "int":
        case "uint8":
        case "uint16":
        case "uint32":
        case "uint64":
          value = getInteger(thing, IOT("value"));
          break;
        default:
          log("Unsupported format", "solid", "ERROR");
          value = null;
      }

      // if value different
      if (value !== null && value != curr.value) {
        // console.log(thing.internal_url, "received at:", Date.now());
        const updated = await curr.setValue?.(value);
        updated && characteristics.set(resourceUrl, { ...updated });
      }
    }
  };
}

// inital hap instance discover & connection
hap.on("instance-discovered", async (instance: HapInstance) => {
  log(
    `Connected to ${instance.name} (${instance.username}) @ ${instance.ipAddress}:${instance.port}`,
    "hap",
    "SUCCESS"
  );
  await connectToSolid();

  // initial sync of device data from homekit to solid
  const services = await hap
    .getAllServices()
    .then((services) => {
      log("Fetched services from homekit!", "hap", "SUCCESS");
      return services;
    })
    .catch((err) => {
      log(`Error fetching services: ${err}`, "hap", "ERROR");
      return [];
    });

  await Promise.all(
    services.map((service: ServiceType) => syncDeviceToSolid(service))
  )
    .then(async (res) => {
      if (argv.groupName) {
        const group = await syncGroupToSolid(
          argv.groupName,
          res.map((val) => val.internal_resourceInfo.sourceIri)
        );
        // set owner of group
        if (session.info.webId) {
          let data = await getSolidDataset(session.info.webId, {
            fetch: session.fetch,
          });
          let thing = getThing(data, session.info.webId)!;
          thing = setUrl(
            thing,
            IOT("owner"),
            group.internal_resourceInfo.sourceIri
          );
          data = setThing(data, thing);
          saveSolidDatasetAt(session.info.webId, data, {
            fetch: session.fetch,
          });
        }
      }
      log("Synced devices to pod!", "solid", "SUCCESS");
    })
    .catch((err) =>
      log(`Error syncing devices to pod: ${err}`, "solid", "ERROR")
    );

  // start monitoring homekit for updates
  log("Starting to monitor for hap events", "hap", "INFO");
  monitorHapEvents();

  // start monitoring solid for updates
  log("Starting to monitor for solid pod updates", "solid", "INFO");
  monitorSolidEvents();
});

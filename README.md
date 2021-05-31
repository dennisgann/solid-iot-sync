# solid-iot-sync
A tool to sync HomeKit device state with a Solid pod and vice-versa.
Allows HomeKit devices to be controlled through a Solid pod.
Uses the IOT ontology to model devices, available at https://dcg.nz/vocab/iot.ttl.


## To get started
Run `npm install`, `npm run build` and `npm start`.

Pass configuration parameters to the sync tool using command line arguments or the configuration JSON file (see `--help` for more info).

You can obtain your Solid IDP tokens using the `./get-tokens` utility.

You will need your HomeKit network pin.

To quickly setup a HomeKit server for testing/demo/evaluation you can use https://github.com/homebridge/homebridge.

Install Homebridge: `sudo npm install -g --unsafe-perm homebridge`

Run: `homebridge -I`

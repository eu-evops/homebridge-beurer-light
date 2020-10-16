var convert = require('color-convert');
var noble = require('@abandonware/noble');
var util = require('util');

var Accessory, Service, Characteristic, UUIDGen;


module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  util.inherits(BeurerLight, Accessory);
  homebridge.registerPlatform("homebridge-beurer", "Beurer", Beurer);
}

function Beurer(log, config, api) {
  var that = this;
  this.log = log;
  this.config = config;
  this.api = api;
  this.accessories = [];

  this.addAccessory = function (accessory, peripheral) {
    var existing = this.accessories.find(function (a) {
      log("Comparing", a.UUID, accessory.UUID, a.UUID === accessory.UUID);
      return a.accessory.UUID === accessory.UUID;
    });

    if (existing) {
      log("Already added, linking with peripheral");
      existing.setPeripheral(peripheral);
      return;
    }

    accessory.addService(Service.Lightbulb);

    accessory.getService(Service.Lightbulb)
      .getCharacteristic(Characteristic.On);

    accessory.getService(Service.Lightbulb)
      .getCharacteristic(Characteristic.Hue);

    accessory.getService(Service.Lightbulb)
      .getCharacteristic(Characteristic.Saturation);

    accessory.getService(Service.Lightbulb)
      .getCharacteristic(Characteristic.Brightness)

    var light = new BeurerLight(accessory, this);
    light.setPeripheral(peripheral);
    this.accessories.push(light);
    this.api.registerPlatformAccessories("homebridge-beurer", "Beurer", [accessory]);
  };

  this.configureAccessory = function (accessory) {
    that.accessories.push(new BeurerLight(accessory, this));
  }

  this.configurationRequestHandler = function (accessory) {
    that.log(":configurationRequestHandler", arguments);

  }

  var findLights = function () {
    noble.on('stateChange', function (state) {
      if (state === "poweredOn") {
        var interestingServiceUuids = ["7087"];
        noble.startScanning(interestingServiceUuids, true, function (error) {
          if (error) {
            that.log("Could not start scanning", error);
          }
        });
      }
    });

    noble.on('discover', function (peripheral) {
      noble.stopScanning();
      this.log('Found device with local name: ' + peripheral.advertisement.localName);

      var accessory = new Accessory("SAD Lamp", UUIDGen.generate(peripheral.uuid));
      this.addAccessory(accessory, peripheral, this);
    }.bind(this));
  }.bind(this)();
}


function BeurerLight(accessory, platform) {
  var that = this;
  this.accessory = accessory;
  this.platform = platform;
  this.log = platform.log;

  this.lampControl;
  this.connectionTimeout = 5000;

  this.hue = 0;
  this.saturation = 0;
  this.brightness = 0;

  this.accessory.getService(Service.Lightbulb)
    .getCharacteristic(Characteristic.On)
    .on('get', this.isLampOn.bind(this))
    .on('set', this.lightOn.bind(this));

  this.accessory.getService(Service.Lightbulb)
    .getCharacteristic(Characteristic.Brightness)
    .on('get', this.getBrightness.bind(this))
    .on('set', this.setBrightness.bind(this));

  this.accessory.getService(Service.Lightbulb)
    .getCharacteristic(Characteristic.Hue)
    .on('get', this.getHue.bind(this))
    .on('set', this.setHue.bind(this));

  this.accessory.getService(Service.Lightbulb)
    .getCharacteristic(Characteristic.Saturation)
    .on('get', this.getSaturation.bind(this))
    .on('set', this.setSaturation.bind(this));

  this.connect = function (peripheral, callback) {
    this.log("Trying to (re)connect to your lamp")
    peripheral.connect(function (error) {
      if (error) {
        console.log("Error connecting to SAD Lamp");
        console.error(error);
        return;
      }

      this.log("Succesfully connected to the lamp");
      this.connected = true;

      peripheral.discoverAllServicesAndCharacteristics(function (error, services, charactersitics) {
        this.log("Found following charactersitics on the lamp");
        that.lampControl = charactersitics.find(function (c) {
          return c.uuid === '8b00ace7eb0b49b0bbe99aee0a26e1a3';
        });

        var notify = charactersitics.find(function (c) {
          return c.uuid === '0734594aa8e74b1aa6b1cd5243059a57';
        });


        notify.on('data', function (data, isNotification) {
          this.log(data, isNotification);

          data.forEach(function (byte, index) {
            this.log(index, byte);
          }.bind(this))

          // this is color
          if (data[8] === 2) {
            var red = data[13];
            var green = data[14];
            var blue = data[15];

            var hsl = convert.rgb.hsl(red, green, blue);

            that.colorBrightness = data[10];
            that.colorOn = data[9] === 1;
          } else {
            that.whiteBrightness = data[10];
            that.whiteOn = data[9] === 1;
          }

          this.log("Updating characterisitc to", that.whiteOn || that.colorOn);
          this.accessory.getService(Service.Lightbulb)
            .getCharacteristic(Characteristic.On)
            .updateValue(that.whiteOn || that.colorOn, null);

          this.accessory.getService(Service.Lightbulb)
            .getCharacteristic(Characteristic.Brightness)
            .updateValue(this.whiteOn ? this.whiteBrightness : this.colorBrightness, null);

          if (hsl) {
            this.accessory.getService(Service.Lightbulb)
              .getCharacteristic(Characteristic.Hue)
              .updateValue(hsl[0], null);

            this.accessory.getService(Service.Lightbulb)
              .getCharacteristic(Characteristic.Saturation)
              .updateValue(hsl[1], null);
          }

          this.accessory.updateReachability(true);


          this.connectionTimeoutToken = setTimeout(this.disconnect.bind(this), this.connectionTimeout);
          callback();
        }.bind(this));

        notify.subscribe();
        notify.notify(true);

        notify.once('notify', function (state) {
          that.log("Characteristic notify state has changed to", state);

          that.lampControl.write(new Buffer([254, 239, 10, 9, 171, 170, 4, 48, 1, 53, 85, 13, 10]), true, function (error) {
            if (error) { console.error("[white] Error sending data", error); }
          })

          that.lampControl.write(new Buffer([254, 239, 10, 9, 171, 170, 4, 48, 2, 54, 85, 13, 10]), true, function (error) {
            if (error) { console.error("[color] Error sending data", error); }
          })
        });
      }.bind(this))
    }.bind(this))
  };

  this.disconnect = function (callback) {
    console.log("Disconnecting")
    this.peripheral.disconnect();
    this.connected = false;

    if (callback) {
      callback();
    }
  }

  this.setPeripheral = function (peripheral) {
    this.peripheral = peripheral;

    this.connect(peripheral, () => {
      console.log("Successfully established bluetooth connection")
    })
  }
}


BeurerLight.prototype = {
  getBytes: function (input) {
    // input.length + 8
    var bytes = []
    var inputBytes = input

    inputBytes[0] = input.length - 1
    inputBytes[inputBytes.length - 2] = this.checkCode(0, inputBytes.length - 2, inputBytes)

    bytes[0] = 254
    bytes[1] = 239
    bytes[2] = 10
    bytes[3] = input.length + 8 - 4
    bytes[4] = 171
    bytes[5] = 170

    for (var i = 0; i < inputBytes.length; i++) {
      bytes[i + 6] = inputBytes[i];
    }

    bytes[input.length + 8 - 2] = 13
    bytes[input.length + 8 - 1] = 10

    return bytes
  },
  checkCode: function (start, finish, bytes) {
    var b = 0;

    for (var i = start; i < (finish - start); i++) {
      b = bytes[start + i] ^ b;
    }

    return b;
  },
  getHue: function (callback) {
    return callback(null, this.hue);
  },
  setHue: function (value, callback) {
    this.hue = value;
    this.setRgb(callback);
  },
  getSaturation: function (callback) {
    callback(null, this.saturation);
  },
  setSaturation: function (value, callback) {
    this.saturation = value;
    this.setRgb(callback);
  },
  getBrightness: function (callback) {
    if (this.color) {
      return callback(null, this.colorBrightness);
    }

    callback(null, this.whiteBrightness);
  },
  setBrightness: function (value, callback) {
    var brightness = value;
    if (this.colorOn) {
      this.colorBrightness = value;
      this.whichLampToControl = 2;
    } else {
      this.whiteBrightness = value;
    }

    this.log("Setting brightness on lamp", this.whichLampToControl, value);
    this.send([0, 49, this.whichLampToControl, value, 0, 85], callback);
  },
  send: function (bytes, callback) {
    if (!this.connected) {
      console.log("Not connected, reconnecting", callback);
      return this.connect(this.peripheral, this.send.bind(this, bytes, callback));
    }

    console.log("Resetting disconnection timeout", this.connectionTimeoutToken)
    clearTimeout(this.connectionTimeoutToken);
    this.connectionTimeoutToken = setTimeout(this.disconnect.bind(this), this.connectionTimeout);

    var self = this;
    var bb = this.getBytes(bytes);
    this.log("Sending", bb);
    this.lampControl.write(Buffer.from(bb), true, function (error) {
      if (error) {
        console.error(error);
      }
      if (callback) {
        callback(error);
      }
    });
  },
  lightOn: function (value, callback) {
    // Not need to turn it on again
    if (value && this.colorOn) {
      console.log("This lamp is already turned on and in colour mode, not turning on")
      return callback();
    }
    // If turning the lamp on, always turn on white

    this.whichLampToControl = 1;
    if (!value && this.colorOn) {
      this.whichLampToControl = 2;
    }

    console.log("Which lamp: %d, whiteOn: %s, colorOn: %s", this.whichLampToControl, this.whiteOn, this.whiteOff)

    if (value) {
      this.whiteOn = true;
      this.colorOn = false;
    } else {
      this.whiteOn = false;
      this.colorOn = false;
    }

    console.log("Controlling lamp", this.whichLampToControl,
      "Is white on?", this.whiteOn,
      "Is color on?", this.colorOn,
      "Value to set", value);

    var onOffBit = value ? 55 : 53;
    this.send([0, onOffBit, this.whichLampToControl, 0, 85], callback);
  },
  isLampOn: function (callback) {
    callback(null, this.whiteOn || this.colorOn);
  },
  setRgb: function (callback) {
    console.log("Setting up rgb colour")
    // If color lamp not turned on
    if (!this.colorOn) {
      this.send([4, 55, 2, 0, 85]);
      this.colorOn = true;
    }

    this.color = true;
    this.colorOn = true;
    this.whiteOn = false;

    var rgb = convert.hsl.rgb(this.hue, this.saturation, 50);
    this.send([0, 50, rgb[0], rgb[1], rgb[2], 0, 85], callback);
  }
}








//
// noble.on('stateChange', function (state) {
//   console.log('State changed', state);
//   if (state === "poweredOn") {
//     noble.startScanning();
//   }
// })
//
noble.on('discoveri', function (peripheral) {
  const txLevel = peripheral.advertisement.txPowerLevel;
  const uuid = peripheral.uuid
  console.log(`[${txLevel}db](${peripheral.uuid}) Found device with local name: ${peripheral.advertisement.localName}`);
  // console.log('advertising the following service uuid\'s: ' + peripheral.advertisement.serviceUuids);
  // console.log();

  console.log(peripheral.uuid === "65c1e78c084a44688bb25ab463a9d59f")

  if (peripheral.uuid === "65c1e78c084a44688bb25ab463a9d59f") {
    console.log("Found my lamp!!!!!!")
    noble.stopScanning();
    peripheral.connect(function (error) {
      if (error) {
        console.error(error);
      }
      console.log("Succesfully connected to the lamp");
      peripheral.updateRssi(function (error, rssi) {
        console.log("Connection quality is:", rssi);
      });

      peripheral.discoverAllServicesAndCharacteristics(function (error, services, charactersitics) {
        var lampControl = charactersitics.find(function (c) {
          return c.uuid === '8b00ace7eb0b49b0bbe99aee0a26e1a3';
        });

        var notify = charactersitics.find(function (c) {
          return c.uuid === '0734594aa8e74b1aa6b1cd5243059a57';
        });

        notify.on('data', function (data, isNotification) {
          console.log(data, isNotification);
        });

        notify.subscribe();
        notify.notify(true);

        notify.once('notify', function (state) {
          console.log("Characteristic notify state has changed to", state);

          // let white = [254, 239, 10, 9, 171, 170, 4, 48, 1, 53, 85, 13, 10];

          let whiteOn = [0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x37, 0x01, 0x32, 0x55, 0x0D, 0x0A];


          // FEEF 0A09 ABAA 0435 0130 550D 0A  
          let whiteOff = [0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x35, 0x01, 0x30, 0x55, 0x0D, 0x0A];


          let first = [0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x30, 0x01, 0x35, 0x55, 0x0D, 0x0A];
          let second = [0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x37, 0x01, 0x32, 0x55, 0x0D, 0x0A];
          let third = [0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x35, 0x01, 0x30, 0x55, 0x0D, 0x0A];

          // let sequence = [first,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          //   second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third, second, third,
          // ];
          // console.log("Will execute sequence of commands", sequence);
          // sequence.forEach(cmd => {
          //   console.log('>>> ')
          //   console.log("Sending " + cmd.map(i => i.toString(16)))
          //   lampControl.write(Buffer.from(cmd), true, console.log);
          // });

          // lampControl.write(new Buffer(whiteOn), true, function (error) {
          //   if (error) { console.error("[white] Error sending data", error); }
          //   console.log("Successfully sent white command")
          // })


          /*
          login and read status when it's fully bright
          Oct 15 23:46:03.046  ATT Send         0x0041  57:4C:82:A5:70:87  Exchange MTU Request - MTU: 185  
          Oct 15 23:46:03.095  ATT Receive      0x0041  57:4C:82:A5:70:87  Exchange MTU Response - MTU: 64  
          Oct 15 23:46:07.911  ATT Send         0x0041  57:4C:82:A5:70:87  Write Command - Handle:0x0041 - Value: FEEF 0A09 ABAA 0430 0135 550D 0A  
          Oct 15 23:46:07.911  ATT Send         0x0041  57:4C:82:A5:70:87  Write Request - Handle:0x0032 - Value: 0100  
          Oct 15 23:46:07.954  ATT Receive      0x0041  57:4C:82:A5:70:87  Handle Value Notification - Handle:0x0031 - Value: FEEF 0C0D ABBB 08D0 0101 =>64   00 78C4 550D…  
          Oct 15 23:46:07.954  ATT Receive      0x0041  57:4C:82:A5:70:87  Write Response  
          */


          /*
          login and read status when it's fully dimm
          Oct 15 23:47:19.840  ATT Send         0x0041  TL100              Exchange MTU Request - MTU: 185  
          Oct 15 23:47:19.896  ATT Receive      0x0041  TL100              Exchange MTU Response - MTU: 64  
          Oct 15 23:47:20.985  ATT Send         0x0041  TL100              Write Command - Handle:0x0041 - Value: FEEF 0A09 ABAA 0430 0135 550D 0A  
          Oct 15 23:47:20.986  ATT Send         0x0041  TL100              Write Request - Handle:0x0032 - Value: 0100  
          Oct 15 23:47:21.036  ATT Receive      0x0041  TL100              Handle Value Notification - Handle:0x0031 - Value: FEEF 0C0D ABBB 08D0 0101 => 01   00 78A1 550D…  
          Oct 15 23:47:21.037  ATT Receive      0x0041  TL100              Write Response  
          */

          /*
          login and read status when it's roughly 50%
          Oct 15 23:48:36.661  ATT Send         0x0041  TL100              Exchange MTU Request - MTU: 185  
          Oct 15 23:48:36.714  ATT Receive      0x0041  TL100              Exchange MTU Response - MTU: 64  
          Oct 15 23:48:37.906  ATT Send         0x0041  TL100              Write Command - Handle:0x0041 - Value: FEEF 0A09 ABAA 0430 0135 550D 0A  
          Oct 15 23:48:37.907  ATT Send         0x0041  TL100              Write Request - Handle:0x0032 - Value: 0100  
          Oct 15 23:48:37.948  ATT Receive      0x0041  TL100              Handle Value Notification - Handle:0x0031 - Value: FEEF 0C0D ABBB 08D0 0101 => 2D    00 788D 550D…  
          Oct 15 23:48:37.948  ATT Receive      0x0041  TL100              Write Response  
          */


          // On
          // [ 52 41 00 FE EF 0A 09 AB AA 04 37 02 31 55 0D 0A ]  
          // [ 52 41 00 FE EF 0A 09 AB AA 04 37 02 31 55 0D 0A ]

          // R
          // 00000000: 5241 00FE EF0A 0BAB AA06 32F6 0013 D155  RA........2....U
          // 00000010: 0D0A                                     ..


          // G
          // 00000000: 5241 00FE EF0A 0BAB AA06 3200 D629 CB55  RA........2..).U
          // 00000010: 0D0A                                     ..


          // B
          // 00000000: 5241 00FE EF0A 0BAB AA06 3210 00E4 C055  RA........2....U
          // 00000010: 0D0A                                     ..

          // Off
          // [ 52 41 00 FE EF 0A 09 AB AA 04 35 02 33 55 0D 0A ]  
          //  52 41 00 FE EF 0A 09 AB AA 04 35 02 33 55 0D 0A  RA........5.3U..

          for (let i = 0; i <= 100; i++) {
            let brightness = i;
            let checksum = i ^ 0x35;
            let cmd = [0xFE, 0xEF, 0x0A, 0x0A, 0xAB, 0xAA, 0x05, 0x31, 0x01, brightness, checksum, 0x55, 0x0D, 0x0A]
            lampControl.write(Buffer.from(cmd), true, console.log)
          }

          // lampControl.write(Buffer.from([0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x37, 0x02, 0x31, 0x55, 0x0D, 0x0A]), true, console.error)

          // // red
          // setTimeout(() => {
          //   let cmd = [0xFE, 0xEF, 0x0A, 0x0B, 0xAB, 0xAA, 0x06, 0x32, 0xF6, 0x00, 0x13, 0xD1, 0x55, 0x0D, 0x0A,]
          //   lampControl.write(Buffer.from(cmd), true, console.error);
          // }, 1000)


          // //green
          // setTimeout(() => {
          //   let cmd = [0xFE, 0xEF, 0x0A, 0x0B, 0xAB, 0xAA, 0x06, 0x32, 0x00, 0xD6, 0x29, 0xCB, 0x55, 0x0D, 0x0A]
          //   lampControl.write(Buffer.from(cmd), true, console.error);
          // }, 2000)

          // //blue
          // setTimeout(() => {
          //   let cmd = [0xFE, 0xEF, 0x0A, 0x0B, 0xAB, 0xAA, 0x06, 0x32, 0x10, 0x00, 0xE4, 0xC0, 0x55, 0x0D, 0x0A]
          //   lampControl.write(Buffer.from(cmd), true, console.error);
          // }, 3000)

          // setTimeout(() => {
          //   lampControl.write(Buffer.from([0xFE, 0xEF, 0x0A, 0x09, 0xAB, 0xAA, 0x04, 0x35, 0x02, 0x33, 0x55, 0x0D, 0x0A,]), true, console.error)
          // }, 5000)

          // // lampControl.write(Buffer.from([254, 239, 10, 9, 171, 170, 4, 48, 2, 54, 85, 13, 10]), true, function (error) {
          // //   if (error) { console.error("[color] Error sending data", error); }
          // //   console.log("Successfully sent color command")
          // // })
        });

      })
    })
  }
});

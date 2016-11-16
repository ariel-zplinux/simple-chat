const {createReadStream, createWriteStream} = require('fs');
// const _ = require('lodash');

const mongoose = require('mongoose');
const db = mongoose.connect("mongodb://localhost/mydb");

const readDictionaryStream =  createReadStream("app/fixtures/session_dictionary.txt")
const readSessionStream = createReadStream("app/fixtures/airbnb_session_data.txt");
const writeLogStream = createWriteStream("app/log/log.txt");
// const readSessionStream = createReadStream("app/fixtures/session_data.txt");

let lines_ok=0, lines_ko=0;


// Read dictionary to initialize collection
readDictionaryStream.on("data", (data) => {
    data = data.toString();
    console.log("read dictionary");
    const dictionary = data.split('|');
    const rawDataSchemaJson = {}
    dictionary.map( (word) => {
        rawDataSchemaJson[word] = {
            type: String,
            required: true,
        }
    }); 
    
    // to ensure the line is relevant (required) and unique (index-uniaue)
    rawDataSchemaJson["id_session"] = {
        type: String,
        required: true,
        index: { unique: true }
    };
    rawDataSchemaJson["device"] = {
        type: String,
        required: true
    };

    // initialize RawData schema and model
    const rawDataSchema = mongoose.Schema(rawDataSchemaJson);
    const RawData = mongoose.model("RawData", rawDataSchema)


    // to handle first and last line of stream edge cases (no full line)
    let n_fields;
    let firstLine, lastLine;

    readSessionStream.on("data", (data) => {
        data = data.toString();
        lines = data.split('\n');
        // c += lines.length;
        // console.log("read "+lines.length);
        const rawDataJson = {}
        let first = true;
        let end = false;
        lines.map( (line) => {
            // to handle first and last line of stream edge cases (no full line)
            n_fields = n_fields || line.split('|').length; 
            if (line.split('|').length !== n_fields ){
                // console.log("first or last line: "+line);
                // first line uncomplete case
                if (first)
                    line = lastLine + line;
                // last line uncomplete case
                else {
                    lastLine = line;
                    end = true;
                }
            }
            // after first line (first line uncomplete case)
            first = false;

            var fields = line.split('|');
            for (var i=0; i< dictionary.length; i++){
                rawDataJson[dictionary[i]] = fields[i];
            }
            let r =  new RawData(rawDataJson)
            // to ensure line is relevant
            if (r.id_session && !end){
                // if (r.id_session === "472d2822a2707b384d27ec510594dcee")
                //     console.log(r);
                r.device = r.dim_device_app_combo.replace(/(.*) -.*/g,'$1');
                r.save( (err) => {
                    if (err){
                        writeLogStream.write("[error] id_session: "+r.id_session+" err: "+err.message+"\n");
                        lines_ko++;
                    }
                    else
                        lines_ok++;
                });
                // c++;
            }                
        });
    });

    readSessionStream.on("end", () => {
        RawData.count( (err, r) => {
            console.log("the end: "+r);
            console.log("verif lines ok: "+lines_ok);
            console.log("verif: lines ko: "+lines_ko);
            // mongoose.connection.close();
        });


        const clientPerUserDeviceMapReduce = {
            map: function() { 
                emit(this.device, 1);
            },
            reduce: function(device, n) { 
                return Array.sum(n);
            },
            scope: {
                total: lines_ok
            },
            finalize: function(key, reduced_value) {
                return {
                    device: key,
                    quantity: ((reduced_value / total) * 100).toFixed(2), // precentage
                    id: key
                }
            },
            query: {},
            out: 'clients_per_user_device'
        };
        RawData.mapReduce(clientPerUserDeviceMapReduce, (err, data, stats) => { 
            if (err)
                console.log(err)
            else if (stats)
                console.log('map reduce took %d ms', stats.processtime)
        });
        mongoose.connection.close();
        writeLogStream.end();    
    });
});

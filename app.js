const debug = require('debug')('app-js')

const fs = require('fs')
const config = require('config')

var https = require("https");
var http = require("http");
const jwt = require('jsonwebtoken')
const express = require('express')
const basicAuth = require('express-basic-auth')

const app = express()
const port = config.port || 9999

let earliestStart = false
let latestFinish = false

if (config.authOptions) {
    app.use(basicAuth(config.authOptions))
}

function convertNameDataToRow(name, data) {
    debug(data)
    let x = data.data.map(function (o) { return Date.parse(o.leave_time) })
    debug(`x: ${x}`)
    let maxTime = Math.max.apply(Math, x)
    debug(`maxTime: `, maxTime)
    // maxTime = x
    // return (`<B>${name}</B>: Total Time: ${(data.totaltime / 60).toFixed(2)} minutes; Joined (earliest): ${getLocalTime(data.data[0].join_time)}; Left (latest): ${getLocalTime(data.data[data.data.length - 1].leave_time)}; ${data.data.length} entries`)
    return (`<B>${name}</B>: Total Time: ${(data.totaltime / 60).toFixed(2)} minutes; Joined (earliest): ${getLocalTime(data.data[0].join_time)}; Left (latest): ${getLocalTime(data.data[0].leave_time)}; ${data.data.length} entr${data.data.length > 1 ? "ies" : "y"}`)
}

function getUTC(inTime) {
    return new Date(Date.UTC(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2)))
}

function getLocalTime(inTime) {
    debug(`getLocalTime(${inTime}) called... ${typeof inTime}`)
    debug(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2))
    let d = new Date(Date.UTC(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2)))
    let response = d.toLocaleTimeString('en-US')
    if (inTime == earliestStart || inTime == latestFinish) {
        response = `<B>${response}</B>`
    }
    return (response)
}

function getLocal(inTime) {
    return new Date(Date.UTC(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2))).toLocaleString("en-US", { timeZone: "America/New_York" })
}

app.get('/mtg/:id', async (request, response) => {
    debug(`/mtg called... ${request.params.id} `)

    const payload = { iss: config.APIKey, exp: ((new Date()).getTime() + 5000) }

    const token = await jwt.sign(payload, config.APISecret)

    const meetingIdStr = request.params.id

    try {
        if (config.meetingIds && config.meetingIds.includes(meetingIdStr)) {
            const meetingId = Number(meetingIdStr)
            if (!isNaN(meetingId)) {
                var options = {
                    "method": "GET",
                    "hostname": "api.zoom.us",
                    "port": null,
                    "path": `/v2/report/meetings/${meetingId}/participants?page_size=100`,
                    "headers": {
                        "authorization": `Bearer ${token}`
                    }
                };

                var req = https.request(options, function (res) {
                    var chunks = [];

                    res.on("data", function (chunk) {
                        chunks.push(chunk);
                    });

                    res.on("end", function () {
                        var body = Buffer.concat(chunks);
                        const result = JSON.parse(body.toString());
                        const namesArr = [];
                        if (result.participants && result.participants.length > 0) {
                            earliestStart = result.participants[0].join_time;
                            latestFinish = result.participants[0].leave_time;

                            for (var p = 0; p < result.participants.length; p++) {
                                let partname = result.participants[p].name
                                if (!Object.keys(namesArr).includes(partname)) {
                                    debug(`...adding ${partname} to namesArr`)
                                    namesArr[partname] = { 'totaltime': 0, 'data': [] }
                                }
                                namesArr[partname]['data'].push(result.participants[p])
                                namesArr[partname]['totaltime'] += result.participants[p].duration

                                if (result.participants[p].join_time < earliestStart) {
                                    earliestStart = result.participants[p].join_time;
                                }
                                if (result.participants[p].leave_time > latestFinish) {
                                    debug(`updating latestFinish from ${latestFinish} to ${result.participants[p].leave_time}`)
                                    latestFinish = result.participants[p].leave_time;
                                }
                            }

                            let names = [...new Set(Object.keys(namesArr))].sort();
                            response.write(`<!doctype html><html lang="en"><head><title>Attendees</title><link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/css/bootstrap.min.css" integrity="sha384-r4NyP46KrjDleawBgD5tp8Y7UzmLA05oM1iAEQ17CSuDqnUK2+k9luXQOfXJCJ4I" crossorigin="anonymous">
                            <style>
                            .totaltimeservice { background-color: blue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
                            .totaltimeboth { background-color: lightblue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
                            </style>
                            </head><body>`);
                            response.write(`<H1>Participants (Meeting: ${meetingId})</H1><EM>Count: ${names.length}</EM>`);

                            response.write(`<p>Earliest Join: ${getLocal(earliestStart)} ET</p><p>Latest Leave: ${getLocal(latestFinish)} ET</p>`);
                            response.write(`<TABLE class="table table-striped table-sm"><thead class="table-dark"><TR><TH colspan=2>Name</TH></TR></thead>`);
                            response.write(`<tbody class="table-light">`)

                            const t = namesArr[names[0]]['data'][0]['leave_time']
                            let localOffset = new Date().getTimezoneOffset() * 60000
                            let endOfServices = new Date(Date.UTC(t.substr(0, 4), t.substr(5, 2), t.substr(8, 2), 11, 35, 00)).getTime() + localOffset

                            names.forEach((name) => {
                                response.write(`<TR><TD>${convertNameDataToRow(name, namesArr[name])}</TD><TD><div class="${getUTC(namesArr[name]['data'][0]['leave_time']) > endOfServices ? "totaltimeservice" : "totaltimeboth"}" style="width:${Math.round(namesArr[name]['totaltime'] / 60)}px;"></div></TR >`);
                            })
                            response.write(`</TD></TR >`);
                            response.write(`</tbody></TABLE>`);
                            response.write(`<script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.0/dist/umd/popper.min.js" integrity="sha384-Q6E9RHvbIyZFJoft+2mJbHaEWldlvI9IOYy5n3zV9zzTtmI3UksdQRVvoxMfooAo" crossorigin="anonymous"></script><script src="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/js/bootstrap.min.js" integrity="sha384-oesi62hOLfzrys4LxRF63OJCXdXDipiYWBnvTl9Y9/TRlw5xlKIEHpNyvvDShgf/" crossorigin="anonymous"></script></body></html>`);
                            response.end();
                        } else {
                            response.send(`No participants found`);
                        }
                    });
                });
                req.end();
            } else {
                response.send("Invalid meeting ID (Not a valid number)")
            }
        } else {
            response.send("Unrecognized meeting ID")
        }
    } catch (error) {
        response.send("Error encountered")
        debug(`Error: ${error}`)
    }
})

if (config.protocol == "https" && config.httpsoptions) {
    const key = fs.readFileSync(config.httpsoptions.key)
    const cert = fs.readFileSync(config.httpsoptions.cert)
    https.createServer({ key: key, cert: cert }, app).listen(port, () => {
        console.log(`Server listening at port ${port}`)
    })
} else { // Default to http
    http.createServer(app).listen(port, () => {
        console.log(`Server listening at port ${port}`)
    })
}


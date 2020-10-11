const debug = require('debug')('app-js')

const fs = require('fs')
const config = require('config')

var https = require("https");
var http = require("http");
const jwt = require('jsonwebtoken')
const express = require('express')
const basicAuth = require('express-basic-auth')

const app = express()
app.use(express.static('public'))

const port = config.port || 9999

let earliestStart = false
let latestFinish = false

if (config.authOptions) {
    app.use(basicAuth(config.authOptions))
}

const meet1Start = { hour: 9, minute: 30 }
const meet2Start = { hour: 10, minute: 30 }

function convertNameDataToRow(name, data) {
    let x = data.data.map(function (o) { return Date.parse(o.leave_time) })
    let maxTime = Math.max.apply(Math, x)
    if (data.data.length === 1) { // Simple case: only a single connection
        const start = new Date(Date.parse(data.data[0].join_time))
        return (`<B>${name}</B>: <!-- Total Time: ${Math.round(data.totaltime / 60)} minutes; -->Joined: ${getLocalTime(data.data[0].join_time)}(${Math.round((Date.parse(data.data[0].leave_time)-start)/(60*1000))} minutes) <!-- ; ${data.data.length} entr${data.data.length > 1 ? "ies" : "y"} -->`)
    } else { // Multiple connections, so parse each one
        let earliest = Date.parse(data.data[0].join_time)
        let latest = Date.parse(data.data[0].leave_time)

        debug(`convertNameDataToRow(${name}, data)...`)
        
        // sort the entries by join_time
        const d = data.data.sort((a, b) => (a.join_time > b.join_time) ? 1 : -1 )

        let resp = `<B>${name}</B>: <!-- Total Time: ${Math.round(data.totaltime / 60)} minutes; --> Joined `

        for (var i = 0; i < d.length; i++) {
            const start = new Date(Date.parse(d[i].join_time))
            resp += `<!--${i}-->${start.toLocaleTimeString('en-US')}(${Math.round((Date.parse(d[i].leave_time)-start)/(60*1000))} min);`
        }
        resp += `<!-- Joined (earliest): ${new Date(earliest).toLocaleTimeString('en-US')}; Left (latest): ${new Date(latest).toLocaleTimeString('en-US')}; ${d.length} entr${d.length > 1 ? "ies" : "y"} -->`
        return(resp)
    }
}

function createConnectionBars(name, data, meet1StartDate, meet2StartDate, endOfServices) {
    debug(`createConnectionBars(${name}, data, ${meet1StartDate}, ${meet2StartDate}, ${endOfServices}) called...`)
    if (data.data.length === 1) { // Simple case: only a single connection
        const wPx1 = getLagTime(data.data[0]['join_time'], meet1StartDate)
        const wPx2 = getLagTime(data.data[0]['join_time'], meet2StartDate)
        // debug(`wPx1: `, wPx1, `; wPx2: `, wPx2)
        if (wPx1.fromMeeting1Start > 45) {
            imgColor = 'navy'
        } else {
            imgColor = 'green'
        }
        
        resp = `<img src='/images/blank-1.png' height='20px' width="${Math.round(wPx1.fromEarliestStart)}px;" title="Joined ${Math.round(wPx1.fromMeeting1Start)} minutes after meeting 1 start time">
            <img src='/images/${imgColor}-1.gif' height='20px' width="${Math.round(data.totaltime / 60)}px;" title="Connected ${Math.round(data.totaltime / 60)} minutes">`

        return(resp)
    } else {
        let resp = ``
        // sort the entries by join_time
        const d = data.data.sort((a, b) => (a.join_time > b.join_time) ? 1 : -1 )
        // debug(`setting priorFinish to ${earliestStart}`)
        let priorFinish = earliestStart

        for (var i = 0; i < d.length; i++) {
            // Create buffer from priorFinish
            if (i === 0) {
                priorText = `earliest start time`
                connType = `Joined`
            } else {
                priorText = `previous disconnect`
                connType = `Rejoined`
            }
            const wPx1 = getLagTime(d[i].join_time, priorFinish)
            const xPx1 = getLagTime(d[i].join_time, meet1StartDate)

            // debug(`>>> priorFinish: ${priorFinish}; d: `, d, `\n>>>> priorText: ${priorText}; wPx1: `, wPx1)

            let imgColor = xPx1.fromMeeting1Start > 45 ? `navy` : `green`

            resp += `<!-- buffer --><img src='/images/blank-1.png' height='20px' width="${Math.round(wPx1.fromMeeting1Start)}px;" title="${connType} ${Math.round(wPx1.fromMeeting1Start)} minutes after ${priorText}">
                <!-- join time --><img src='/images/${imgColor}-1.gif' height='20px' width="${Math.round(d[i].duration / 60)}px;" title="Connected ${Math.round(d[i].duration / 60)} minutes">`
            priorFinish = Date.parse(d[i].leave_time)
        }
        return resp
    }
}

function getUTC(inTime) {
    return new Date(Date.UTC(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2)))
}

function getLocalTime(inTime) {
    // debug(`getLocalTime() called...`)
    let d = Date.parse(inTime)
    // debug(`...d: ${d}; inTime: ${inTime}; earliestStart: ${earliestStart}; latestFinish: ${latestFinish}`)
    let response = new Date(d).toLocaleTimeString('en-US')
    if (d == earliestStart || d == latestFinish) {
        response = `<span class="timeHighlight">${response}</span>`
    }
    // debug(`...returning ${response}`)
    return (response)
}

function getLocal(inTime) {
    return new Date(inTime)
}

function getLagTime(startTime, meetingStartTimeMS) {
    const d = Date.parse(startTime)
    const deltaE = (d - earliestStart)/(60*1000)
    const delta1 = (d - meetingStartTimeMS)/(60*1000)
    // debug(`getLagTime(${startTime}, ${meetingStartTimeMS}) called... convertedStartTime: ${d} / ${new Date(d)}... meetingStartTimeMS: ${meetingStartTimeMS} / ${new Date(meetingStartTimeMS)}... deltaE: ${deltaE}, delta1: ${delta1}`)
    return { fromEarliestStart: deltaE, fromMeeting1Start: delta1 }
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
                            earliestStart = Date.parse(result.participants[0].join_time);
                            latestFinish = Date.parse(result.participants[0].leave_time);

                            for (var p = 0; p < result.participants.length; p++) {
                                let partname = result.participants[p].name
                                if (!Object.keys(namesArr).includes(partname)) {
                                    // debug(`...adding ${partname} to namesArr`)
                                    namesArr[partname] = { 'totaltime': 0, 'data': [] }
                                }
                                namesArr[partname]['data'].push(result.participants[p])
                                namesArr[partname]['totaltime'] += result.participants[p].duration

                                let myStart = Date.parse(result.participants[p].join_time)
                                let myEnd = Date.parse(result.participants[p].leave_time)

                                if (myStart < earliestStart) {
                                    earliestStart = myStart;
                                }
                                if (myEnd > latestFinish) {
                                    latestFinish = myEnd;
                                }
                            }

                            // Now calculate the meeting start times
                            const e = new Date(earliestStart)
                            const meet1StartDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), meet1Start.hour, meet1Start.minute, 0)
                            const meet2StartDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), meet2Start.hour, meet2Start.minute, 0)
                            // debug(`meet1StartDate = ${meet1StartDate}`)
                            // debug(`meet2StartDate = ${meet2StartDate}`)

                            let names = [...new Set(Object.keys(namesArr))].sort();
                            response.write(`<!doctype html><html lang="en"><head><title>Attendees</title><link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/css/bootstrap.min.css" integrity="sha384-r4NyP46KrjDleawBgD5tp8Y7UzmLA05oM1iAEQ17CSuDqnUK2+k9luXQOfXJCJ4I" crossorigin="anonymous">
                            <style>
                            .timeblank { background-color: green; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
                            .totaltimeservice { background-color: blue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
                            .totaltimeboth { background-color: lightblue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
                            .timeHighlight { color: blue; font-weight: bold; }
                            </style>
                            </head><body>`);
                            response.write(`<H1>Participants (Meeting: ${meetingId})</H1><EM>Count: ${names.length}</EM>`);

                            response.write(`<p>Earliest Join: ${getLocal(earliestStart)}<BR>Latest Leave: ${getLocal(latestFinish)}</p>`);
                            response.write(`<TABLE class="table table-striped table-sm" style="width: auto !important;"><thead class="table-dark"><TR><TH colspan=2>Name</TH></TR></thead>`);
                            response.write(`<tbody class="table-light">`)

                            const t = namesArr[names[0]]['data'][0]['leave_time']
                            let localOffset = new Date().getTimezoneOffset() * 60000
                            let endOfServices = new Date(Date.UTC(t.substr(0, 4), t.substr(5, 2), t.substr(8, 2), 11, 35, 0)).getTime() + localOffset

                            names.forEach((name) => {
                                response.write(`<TR><TD>${convertNameDataToRow(name, namesArr[name])}</TD>`)
                                response.write(`<TD><div>`)
                                response.write(createConnectionBars(name, namesArr[name], meet1StartDate, meet2StartDate, endOfServices))
                                response.write(`</div></TD></TR>`)
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


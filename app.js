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

if (config.authOptions) {
    app.use(basicAuth(config.authOptions))
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
                            let earliestStart = result.participants[0].join_time;
                            let latestFinish = result.participants[0].leave_time;

                            for (var p = 0; p < result.participants.length; p++) {
                                namesArr.push(result.participants[p].name);
                                if (result.participants[p].join_time < earliestStart) {
                                    earliestStart = result.participants[p].join_time;
                                }
                                if (result.participants[p].leave_time > latestFinish) {
                                    latestFinish = result.participants[p].leave_time;
                                }
                            }

                            let names = [...new Set(namesArr)].sort();
                            response.write(`<!doctype html><html lang="en"><head><title>Attendees</title><link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/css/bootstrap.min.css" integrity="sha384-r4NyP46KrjDleawBgD5tp8Y7UzmLA05oM1iAEQ17CSuDqnUK2+k9luXQOfXJCJ4I" crossorigin="anonymous"></head><body>`);
                            response.write(`<H1>Participants (Meeting: ${meetingId})</H1><EM>Count: ${names.length}</EM>`);

                            response.write(`<p>Earliest Join: ${getLocal(earliestStart)} ET</p><p>Latest Leave: ${getLocal(latestFinish)} ET</p>`);
                            response.write(`<TABLE class="table table-striped table-sm"><thead class="table-dark"><TR><TH>Name</TH></TR></thead>`);
                            response.write(`<tbody class="table-light"><TR><TD>${names.join("</TD></TR><TR><TD>")}</TD></TR>`);
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


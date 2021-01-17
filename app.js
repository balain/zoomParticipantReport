const debug = require('debug')('app-js')
const fetch = require('node-fetch')

const fs = require('fs')
const config = require('config')
const NodeCache = require('node-cache')
const cache = new NodeCache()

let sqlite3 = false
let db = false

if (config.sqlite && config.sqlite.filename) {
  sqlite3 = require('sqlite3')
  db = new sqlite3.Database(config.sqlite.filename)
}

var https = require('https')
var http = require('http')
const jwt = require('jsonwebtoken')
const express = require('express')
const basicAuth = require('express-basic-auth')

const app = express()
app.use(express.static('public'))

const port = config.port || 9999

const HTML_FORMAT = "html"
const JSON_FORMAT = "json"

let earliestStart = false
let latestFinish = false

const BOOTSTRAP_HEADER = `<!doctype html><html lang="en"><head><title>Attendees</title><link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/css/bootstrap.min.css" integrity="sha384-r4NyP46KrjDleawBgD5tp8Y7UzmLA05oM1iAEQ17CSuDqnUK2+k9luXQOfXJCJ4I" crossorigin="anonymous"></link>
<style>
  .mtgCol { white-space: nowrap; text-align: center; }
  .timeblank { background-color: green; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
  .totaltimeservice { background-color: blue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
  .totaltimeboth { background-color: lightblue; empty-cells: show;padding: 10px;align-content: center;vertical-align: middle;margin: 2px; }
  .timeHighlight { color: blue; font-weight: bold; }
</style>`

const BOOTSTRAP_FOOTER = `<script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.0/dist/umd/popper.min.js" integrity="sha384-Q6E9RHvbIyZFJoft+2mJbHaEWldlvI9IOYy5n3zV9zzTtmI3UksdQRVvoxMfooAo" crossorigin="anonymous"></script><script src="https://stackpath.bootstrapcdn.com/bootstrap/5.0.0-alpha1/js/bootstrap.min.js" integrity="sha384-oesi62hOLfzrys4LxRF63OJCXdXDipiYWBnvTl9Y9/TRlw5xlKIEHpNyvvDShgf/" crossorigin="anonymous"></script></body></html>`

if (config.authOptions) {
  app.use(basicAuth(config.authOptions))
}

const meet1Start = { hour: 9, minute: 30 }
const meet2Start = { hour: 10, minute: 30 }

function convertNameDataToRow (name, data) {
  const x = data.data.map(function (o) { return Date.parse(o.leave_time) })
  if (data.data.length === 1) { // Simple case: only a single connection
    const start = new Date(Date.parse(data.data[0].join_time))
    return (`<B>${name}</B>: <!-- Total Time: ${Math.round(data.totaltime / 60)} minutes; -->Joined: ${getLocalTime(data.data[0].join_time)}(${Math.round((Date.parse(data.data[0].leave_time) - start) / (60 * 1000))} minutes) <!-- ; ${data.data.length} entr${data.data.length > 1 ? 'ies' : 'y'} -->`)
  } else { // Multiple connections, so parse each one
    const earliest = Date.parse(data.data[0].join_time)
    const latest = Date.parse(data.data[0].leave_time)

    // sort the entries by join_time
    const d = data.data.sort((a, b) => (a.join_time > b.join_time) ? 1 : -1)

    let resp = `<B>${name}</B>: <!-- Total Time: ${Math.round(data.totaltime / 60)} minutes; --> Joined `

    for (var i = 0; i < d.length; i++) {
      const start = new Date(Date.parse(d[i].join_time))
      resp += `<!--${i}-->${start.toLocaleTimeString('en-US')}(${Math.round((Date.parse(d[i].leave_time) - start) / (60 * 1000))} min);`
    }
    resp += `<!-- Joined (earliest): ${new Date(earliest).toLocaleTimeString('en-US')}; Left (latest): ${new Date(latest).toLocaleTimeString('en-US')}; ${d.length} entr${d.length > 1 ? 'ies' : 'y'} -->`
    return (resp)
  }
}

function createConnectionBars (name, data, meet1StartDate, meet2StartDate, endOfServices) {
  let imgColor = 'blue'
  let resp = ''

  if (data.data.length === 1) { // Simple case: only a single connection
    const wPx1 = getLagTime(data.data[0].join_time, meet1StartDate)
    if (wPx1.fromMeeting1Start > 45) {
      imgColor = 'navy'
    } else {
      imgColor = 'green'
    }

    resp = `<img src='/images/blank-1.png' height='20px' width="${Math.round(wPx1.fromEarliestStart)}px;" title="Joined ${Math.round(wPx1.fromMeeting1Start)} minutes after meeting 1 start time">
        <img src='/images/${imgColor}-1.gif' height='20px' width="${Math.round(data.totaltime / 60)}px;" title="Connected ${Math.round(data.totaltime / 60)} minutes">`

    return (resp)
  } else {
    let resp = ''
    let priorText = ''
    let connType = ''

    // sort the entries by join_time
    const d = data.data.sort((a, b) => (a.join_time > b.join_time) ? 1 : -1)
    let priorFinish = earliestStart

    for (var i = 0; i < d.length; i++) {
      // Create buffer from priorFinish
      if (i === 0) {
        priorText = 'earliest start time'
        connType = 'Joined'
      } else {
        priorText = 'previous disconnect'
        connType = 'Rejoined'
      }
      const wPx1 = getLagTime(d[i].join_time, priorFinish)
      const xPx1 = getLagTime(d[i].join_time, meet1StartDate)

      const imgColor = xPx1.fromMeeting1Start > 45 ? 'navy' : 'green'

      resp += `<!-- buffer --><img src='/images/blank-1.png' height='20px' width="${Math.round(wPx1.fromMeeting1Start)}px;" title="${connType} ${Math.round(wPx1.fromMeeting1Start)} minutes after ${priorText}">
        <!-- join time --><img src='/images/${imgColor}-1.gif' height='20px' width="${Math.round(d[i].duration / 60)}px;" title="Connected ${Math.round(d[i].duration / 60)} minutes">`
      priorFinish = Date.parse(d[i].leave_time)
    }
    return resp
  }
}

// function getUTC (inTime) {
//   return new Date(Date.UTC(inTime.substr(0, 4), inTime.substr(5, 2), inTime.substr(8, 2), inTime.substr(11, 2), inTime.substr(14, 2), inTime.substr(17, 2)))
// }

function getLocalTime (inTime) {
  const d = Date.parse(inTime)
  let response = new Date(d).toLocaleTimeString('en-US')
  if (d === earliestStart || d === latestFinish) {
    response = `<span class="timeHighlight">${response}</span>`
  }
  return (response)
}

function getLocal (inTime) {
  return new Date(inTime)
}

function getLagTime (startTime, meetingStartTimeMS) {
  const d = Date.parse(startTime)
  const deltaE = (d - earliestStart) / (60 * 1000)
  const delta1 = (d - meetingStartTimeMS) / (60 * 1000)
  return { fromEarliestStart: deltaE, fromMeeting1Start: delta1 }
}

async function buildToken() {
  const payload = { iss: config.APIKey, exp: ((new Date()).getTime() + 5000) }
  return await jwt.sign(payload, config.APISecret)
}

async function buildOptions(path, method = 'GET', hostname = 'api.zoom.us') {
  debug(`buildOptions(${path}, ${method}, ${hostname}) called...`)
  const token = await buildToken()

  return {
      method: method,
      hostname: hostname,
      port: null,
      path: path,
      headers: {
        authorization: `Bearer ${token}`
      }
    }
}

app.get('/users', async (request, response) => {
  debug(`/users called...`)

  try {
    var options = await buildOptions(`/v2/users`)

    var req = https.request(options, function (res) {
      var chunks = []

      res.on('data', function (chunk) {
        chunks.push(chunk)
      })

      res.on('end', function () {
        var body = Buffer.concat(chunks);
        const result = JSON.parse(body.toString())
        response.send(result)
      })
    })

    req.end()

  } catch (err) {
    response.send(err)
  }
})

app.get('/past_meetings_full/:id', async (request, response) => {
  const meetingIdStr = request.params.id

  try {
    if (config.meetingIds && config.meetingIds.includes(meetingIdStr)) {
      const meetingId = Number(meetingIdStr)
      if (!isNaN(meetingId)) {
        var options = await buildOptions(`/v2/meetings/${meetingId}?show_previous_occurrences=true`)
        debug(`options: `, options)
        var req = https.request(options, function (res) {
          var chunks = []

          res.on('data', function (chunk) {
            chunks.push(chunk)
          })

          res.on('end', function () {
            var body = Buffer.concat(chunks);
            const result = JSON.parse(body.toString())
            debug(`Occurrences? `, response.occurrences ? 'YES has occurrences' : 'NO occurrences')
            response.send(result)
            // response.send(result.meetings.sort((a, b) => { return (b.start_time < a.start_time) ? -1 : (b.start_time > a.start_time) ? 1 : 0 }))
          })
        })
      }
    }
    req.end()
  } catch (err) {
    response.send(err)
  }
})

app.get('/past_meetings/:id', async (request, response) => {
  const meetingIdStr = request.params.id
  const format = request.query.format ? request.query.format : HTML_FORMAT

  try {
    if (config.meetingIds && config.meetingIds.includes(meetingIdStr)) {
      const meetingId = Number(meetingIdStr)
      if (!isNaN(meetingId)) {
        const cacheId = `past_meetings-${meetingId}`
        if (!cache.has(cacheId)) {
          debug(`...creating cache ${cacheId}`)

          var options = await buildOptions(`/v2/past_meetings/${meetingId}/instances`)
          var req = https.request(options, function (res) {
            var chunks = []
            var cacheContent = []

            res.on('data', function (chunk) {
              chunks.push(chunk)
            })

            res.on('end', function () {
              var body = Buffer.concat(chunks);
              const result = JSON.parse(body.toString())

              let meetings = result.meetings.sort((a, b) => { return (b.start_time < a.start_time) ? -1 : (b.start_time > a.start_time) ? 1 : 0 })

              if (format == HTML_FORMAT) {
                let id = meetings.length
                let seq = 0
                cacheContent.push('<table><thead><tr><th>#</th><th>Date</th></tr></thead><tbody>')
                meetings.forEach((mtg) => {
                  // debug(mtg)

                  cacheContent.push(`<tr><td>${id}</td><td><a href='/mtg?id=${meetingId}&instance=${encodeURIComponent(mtg.uuid)}'>${mtg.start_time.substr(0, 10)}</a></td></tr>`)
                  id--
                  seq++
                })
                cacheContent.push('</tbody></table>')
                cache.set(cacheId, cacheContent.join(''))
                response.write(cacheContent.join(''))
                response.end()
              } else {
                response.send(meetings)
              }
            })
          })
          req.end()
        } else {
          debug(`...returning content from cache (ID: ${cacheId})`)
          response.write(cache.get(cacheId))
        }
      }
    }
  } catch (err) {
    response.send(err)
  }
})

function cleanFieldContents(content) {
  return(content.replace(/\'/g, "''"))
}

async function dbHasAttendees(meetingId, meetingInstance) {
  debug(`dbHasAttendees(${meetingId}, ${meetingInstance}) called...`)
  return new Promise((resolve, reject) => {
    // TODO: Check if this is the latest meeting instance
    // ...if so, the meetingInstance field would be null
    const sql = `SELECT count(*) as counter FROM attendees WHERE meetingId=${meetingId} AND meetingInstance='${cleanFieldContents(meetingInstance)}'`
    debug(`... sql: ${sql}`)
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err)
      }

      resolve(rows[0].counter == 0 ? false : rows[0].counter)
    })
  })
}

async function updateMeetingAttendeesDatabase(meetingId, meetingInstance, data) {
  debug(`updateMeetingAttendeesDatabase(${meetingId}, ${meetingInstance}, data) called...`)
  const cacheId = `attendeesRecorded-${meetingId}`
  meetingInstance = meetingInstance == false ? 'null' : meetingInstance
  debug(`...meetingInstance == ${meetingInstance}`)

  const history = await dbHasAttendees(meetingId, meetingInstance)
  debug(`history: `, history)
  if (history) { // If so, use it
    debug(`dbHasHistory returned true, so not updating db.`)
    cache.set(cacheId, true)
  } else { // If not, fetch it and add it to the db
    db.serialize(() => {
      debug(`Updating database with history for meeting ID ${meetingId}`)

      let delSql = `DELETE FROM attendees WHERE meetingId=${meetingId} AND meetingInstance${meetingInstance == 'null' ? ` is null` : `='${cleanFieldContents(meetingInstance)}'`}`
      debug(`delSql = ${delSql}`)
      db.run(delSql)

      data.participants.forEach((usr) => {
        let insSql = `INSERT INTO attendees (
            meetingId,
            meetingInstance,
            id,
            user_id,
            name,
            user_email,
            join_time,
            leave_time,
            duration
          ) VALUES (
            ${meetingId},
            ${meetingInstance == 'null' ? null : `'${cleanFieldContents(meetingInstance)}'`},
            '${usr.id}',
            '${usr.user_id}',
            '${cleanFieldContents(usr.name)}',
            '${usr.user_email}',
            '${usr.join_time}',
            '${usr.leave_time}',
            ${usr.duration}
          )
          `
        db.run(insSql)
      })
      cache.set(cacheId, true)
    })
  } // if (dbHasHistory(...))
}

async function getPrevNextMeeting(meetingId, meetingInstance) {
  let history = await getMeetingHistory(meetingId)

  debug(`getPrevNextMeeting(${meetingId}, ${meetingInstance}) called...`)

  meetings = history.meetings.sort((a, b) => { return (b.start_time > a.start_time) ? -1 : (b.start_time < a.start_time) ? 1 : 0 })

  let response = { prev: false, next: false }

  let ndx = meetings.length - 1

  if (meetingInstance) {
    ndx = meetings.findIndex(x => x.uuid == meetingInstance)
  }

  if (ndx > 0) { response.prev = meetings[ndx - 1] }
  if (ndx < meetings.length - 1) { response.next = meetings[ndx + 1] }

  // debug(`...returning: `, response)
  return(response)
}

async function getMeetingHistory(meetingId) {
  const cacheId = `meetingHistory-${meetingId}`
  return new Promise(async (resolve, reject) => {
    if (!cache.has(cacheId)) {
      const path = `/v2/past_meetings/${meetingId}/instances`
      var options = await buildOptions(path)
      const response = await fetch(`https://api.zoom.us${path}`, options)
      const json = await response.json()
      // If the database is setup, update the records
      db.serialize(() => {
        debug(`Updating database with history for meeting ID ${meetingId}`)

        db.run(`DELETE FROM history WHERE id=${meetingId}`)
        json.meetings.forEach((mtg) => {
          db.run(`INSERT INTO history(id, uuid, start_time) VALUES (${meetingId}, '${mtg.uuid}', '${mtg.start_time}')`)
        })
      })
      cache.set(cacheId, json)
      debug(`...cache updated`)
    } else {
      debug(`...returning from cache`)
    }
    resolve(cache.get(cacheId))
  })
}

app.get('/history/:id', async (request, response) => {
  res.write(`history: `)
  res.send(await getMeetingHistory(request.params.id))
})

async function meetingAttendanceHistory(meetingId) {
  const sql = `SELECT * FROM attendees WHERE meetingId=${meetingId}`
  debug(`... sql: ${sql}`)
  db.all(sql, [], (err, rows) => {
    if (err) {
      reject(err)
    }
    resolve(rows[0].counter)
  })
}

app.get('/attendanceLog/:id', async (request, response) => {
  const meetingId = request.params.id
  // Get meeting dates - table columns
  const sqlMtgs = `SELECT uuid, substr(start_time, 0,5) || " " || substr(start_time, 6,5) as mtgDate FROM history WHERE id=${meetingId} ORDER BY mtgDate DESC`
  debug(`... sqlMtgs: ${sqlMtgs}`)
  db.all(sqlMtgs, [], (errMtgs, rowsMtgs) => {
    if (errMtgs) {
      response.write(errMtgs)
      response.end()
    } else {
      // Print the columns
      const mtgUuids = {}
      const mtgDatesToUuids = {}
      const mtgSequence = []
      rowsMtgs.forEach((mtg) => {
        mtgUuids[mtg.uuid] = mtg.mtgDate
        mtgDatesToUuids[mtg.mtgDate] = mtg.uuid
        mtgSequence.push(mtg.uuid)
      })
      // debug(mtgUuids)
      // debug(mtgDatesToUuids)

      const mtgDates = rowsMtgs.map(x => x.mtgDate)
      response.write(BOOTSTRAP_HEADER)
      response.write(`<TABLE class="table table-striped table-sm" style="width: auto !important;"><thead class="table-dark">
        <tr>
          <th>name</th>
          <th class="mtgCol">${mtgDates.map(x => x.replace(/\s/g, '<BR>')).join('</th><th class="mtgCol">')}</th>
        </tr></thead>
        <tbody>`)

      // Now get attendee name and join info
      const sqlAttend = `SELECT * FROM attendees WHERE meetingId=${meetingId} AND meetingInstance is not null ORDER BY name`
      debug(`... sqlAttend: ${sqlAttend}`)
      db.all(sqlAttend, [], (errAttend, rowsAttend) => {
        if (errAttend) {
          response.write(errAttend)
          response.end()
        } else {
          // Get the names of attendees
          const attendees = {}
          rowsAttend.forEach((row) => {
            if (!Object.keys(attendees).includes(row.name)) {
              attendees[row.name] = []
            }
            // debug(`...updating attendees[${row.name}] - adding ${row.meetingInstance}`)
            attendees[row.name].push(row.meetingInstance)
          })
          // Reformat the data
          // Then print the columns for each attendee
          Object.keys(attendees).sort().forEach((attendee) => {
            response.write(`<tr><td>${attendee}</td>`)
            // Now print the row
            mtgSequence.forEach((mtgUuid) => {
              response.write(`<td
                class="mtgCol ${attendees[attendee].includes(mtgUuid) ? 'table-success' : 'absent'}"
                title='Attendee: ${attendee.replace(/\'/g, "&apos;")}\nUUID: ${mtgUuid}\nDate: ${mtgUuids[mtgUuid]}'>
                </td>`)
            })
            response.write(`</tr>`)
          })
          response.write(`</tbody></table>`)
          response.write(BOOTSTRAP_FOOTER)
          response.end()
        }
      })
    }
  })
})

app.get('/mtg', async (request, response) => {
  debug(`/mtg called...`)

  const meetingId = request.query.id ? request.query.id : false
  const meetingInstance = request.query.instance ? request.query.instance : false
  const meeting = meetingInstance || meetingId

  debug(`meetingId: ${meetingId}; meetingInstance: ${meetingInstance}; meeting: ${meeting}`)

  let prevNextMeetings = await getPrevNextMeeting(meetingId, meetingInstance)

  try {
    var path = `/v2/report/meetings/${meeting}/participants?page_size=100`
    const options = await buildOptions(path)
    const fetchResponse = await fetch(`https://api.zoom.us${path}`, options)
    const result = await fetchResponse.json()

    updateMeetingAttendeesDatabase(meetingId, meetingInstance, result)

    const namesArr = []
    if (result.participants && result.participants.length > 0) {
      earliestStart = Date.parse(result.participants[0].join_time)
      latestFinish = Date.parse(result.participants[0].leave_time)

      for (var p = 0; p < result.participants.length; p++) {
        const partname = result.participants[p].name
        if (!Object.keys(namesArr).includes(partname)) {
          // debug(`...adding ${partname} to namesArr`)
          namesArr[partname] = { totaltime: 0, data: [] }
        }
        namesArr[partname].data.push(result.participants[p])
        namesArr[partname].totaltime += result.participants[p].duration

        const myStart = Date.parse(result.participants[p].join_time)
        const myEnd = Date.parse(result.participants[p].leave_time)

        if (myStart < earliestStart) {
          earliestStart = myStart
        }
        if (myEnd > latestFinish) {
          latestFinish = myEnd
        }
      }

      // Now calculate the meeting start times
      const e = new Date(earliestStart)
      const meet1StartDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), meet1Start.hour, meet1Start.minute, 0)
      const meet2StartDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), meet2Start.hour, meet2Start.minute, 0)

      const names = [...new Set(Object.keys(namesArr))].sort()
      response.write(BOOTSTRAP_HEADER)
      response.write(`<H1>Participants (Meeting: ${meetingId})</H1>`)
      response.write(`<div>`)
      if (prevNextMeetings.prev) {
        response.write(`<a href='/mtg?id=${meetingId}&instance=${encodeURIComponent(prevNextMeetings.prev.uuid)}'>Prev meeting (${prevNextMeetings.prev.start_time.substr(0,10)})</a>`)
      }
      response.write(`<span style='padding: 5px;'>Date: ${namesArr[names[0]].data[0].join_time.substr(0,10)}</span>`)
      if (prevNextMeetings.next) {
        response.write(`<a href='/mtg?id=${meetingId}&instance=${encodeURIComponent(prevNextMeetings.next.uuid)}'>Next meeting (${prevNextMeetings.next.start_time.substr(0,10)})</a>`)
      }
      response.write(`</div>`)
      response.write(`<EM> Count: ${ names.length }</EM>`)

      response.write(`<p>Earliest Join: ${getLocal(earliestStart)}<BR>Latest Leave: ${getLocal(latestFinish)}</p>`)
      response.write('<TABLE class="table table-striped table-sm" style="width: auto !important;"><thead class="table-dark"><TR><TH colspan=2>Name</TH></TR></thead>')
      response.write('<tbody class="table-light">')

      const t = namesArr[names[0]].data[0].leave_time
      const localOffset = new Date().getTimezoneOffset() * 60000
      const endOfServices = new Date(Date.UTC(t.substr(0, 4), t.substr(5, 2), t.substr(8, 2), 11, 35, 0)).getTime() + localOffset

      names.forEach((name) => {
        response.write(`<TR><TD>${convertNameDataToRow(name, namesArr[name])}</TD>`)
        response.write('<TD><div>')
        response.write(createConnectionBars(name, namesArr[name], meet1StartDate, meet2StartDate, endOfServices))
        response.write('</div></TD></TR>')
      })
      response.write('</TD></TR>')
      response.write('</tbody></TABLE>')
      response.write(BOOTSTRAP_FOOTER)
      response.end()
    } else {
      // No participants
      response.write(BOOTSTRAP_HEADER)
      // response.write('No participants found')
      response.write(`<div>`)
      if (prevNextMeetings.prev) {
        response.write(`<a href='/mtg?id=${meetingId}&instance=${prevNextMeetings.prev.uuid}'>Prev meeting (${prevNextMeetings.prev.start_time.substr(0,10)})</a>`)
      }
      // response.write(`<span style='padding: 5px;'>Date: ${namesArr[names[0]].data[0].join_time.substr(0,10)}</span>`)
      if (prevNextMeetings.next) {
        response.write(`<a href='/mtg?id=${meetingId}&instance=${prevNextMeetings.next.uuid}'>Next meeting (${prevNextMeetings.next.start_time.substr(0,10)})</a>`)
      }
      response.write(`</div>`)
      response.write(BOOTSTRAP_FOOTER)
      response.end()
    }
  } catch (error) {
    response.write('Error encountered')
    response.end()
    debug(`Error: ${error}`)
  }
})

let server = false

if (config.protocol === 'https' && config.httpsoptions) {
  const key = fs.readFileSync(config.httpsoptions.key)
  const cert = fs.readFileSync(config.httpsoptions.cert)
  server = https.createServer({ key: key, cert: cert }, app).listen(port, () => {
    console.log(`Server listening at port ${port}`)
  })
} else { // Default to http
  server = app.listen(port, () => {
    console.log(`Server listening at port ${port}`)
  })
}

process.on('SIGINT', () => {
  console.log(`SIGINT caught...`)
  cleanExit()
  process.exit(1)
})

process.on('SIGTERM', () => {
  console.log(`SIGTERM caught...`)
  cleanExit()
  process.exit(1)
})

function cleanExit() {
  if (db) {
    console.info(`db... `, db)
    db.close((err) => {
      debug(`db closed: ${err}`)
      if (err) {
        console.info(`ERROR closing database: ${err}`)
      } else {
        console.info(`Database closed`)
      }
    })
  } else {
    console.info(`Database not connected`)
  }
  server.close()
  console.info(`Server closed`)

  return(1)
}
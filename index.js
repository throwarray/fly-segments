const express = require('express')
const fluent = require('fluent-ffmpeg')
const { join: joinPath } = require('path')
const { getMetadata, stripExt, parseContentID, padTime } = require('./utils.js')

const DEFAULT_SEGMENT_DURATION = 20
const THREADS =  require('os').cpus().length
const app = express()

function getM3U8Header (segment_duration = DEFAULT_SEGMENT_DURATION) {
    return (
        '#EXTM3U\n' + 
        '#EXT-X-VERSION:7\n' +
        `#EXT-X-TARGETDURATION:${Math.round(segment_duration)}` + '\n' + 
        '#EXT-X-MEDIA-SEQUENCE:0\n' + 
        '#EXT-X-PLAYLIST-TYPE:VOD\n'
    )
}

// FIXME
// The collection of videos to serve
const CATALOG = new Map([
    ['test_stream', { 
        id: 'test_stream',
        filepath: joinPath(__dirname, './media/song.mp4'),
        manifest: '',
        data: null
    }]
])

// Serve a master playlist incase it's needed
app.get('/master/:manifest', function (req, res) {
    const manifest_name = req.params.manifest
    res.setHeader('Content-Type', 'application/x-mpegurl')
    res.end(
        '#EXTM3U\n' + 
        '#EXT-X-STREAM-INF:BANDWIDTH=1,AVERAGE-BANDWIDTH=1\n'+
        'http://localhost:3000/streams/' + manifest_name
    )
})

// Get a video segment
app.get('/streams/:id/vid_:segment', function (req, res, next) {
    const id = parseContentID(req.params.id)

    const data = CATALOG.get(id) || {}

    if (!data || !data.data || !data.filepath) {
        next()

        return
    }

    const meta = data.data
    const segment_name = req.params.segment
    const segment_number = Math.ceil(Math.max(
            Math.min(Number(stripExt(segment_name)), meta.segment_count - 1),
            0
        )
    ) || 0

    const segment_start = segment_number * meta.segment_duration

    const segment_duration = segment_number >= meta.segment_count - 1 ?
        meta.last_segment_duration:
        meta.segment_duration

    res.contentType('application/mp2t')

    fluent(data.filepath).inputOptions(['-ss '+ Number(segment_start)]).outputOptions([
        '-t '+ Number(segment_duration),
        '-s hd480',
        '-r 30',
        '-crf 23',
        '-maxrate:v 500K',
        '-maxrate:a 128k',
        '-c:a aac',
        '-c:v libx264',
        '-preset ultrafast',
        '-strict -2',
        `-threads ${THREADS}`,
        '-f mpegts'
    ])
    .on('error', function(err /*, _stdout, _stderr*/) { 
        if (err.message === 'Output stream closed') return

        console.log('cannot process segment:', id, segment_number, segment_duration * segment_number + 's')
        console.warn(err.message) 
    })
    .pipe(res, { end: true })
}, function (_req, res) {
    res.status(404)
    res.end('not found')
})

// Get a video manifest
app.get('/streams/:id.m3u8', function (req, res, next) {
    const id = parseContentID(req.params.id) //NOTE prevent ../ and http://

    const meta = CATALOG.get(id) || {}

    if (!meta.filepath) {
        next()
        
        return
    }

    // Cached manifest
    if (meta.manifest) {
        res.setHeader('Content-Type', 'application/x-mpegurl')

        res.end(meta.manifest)

        return
    }

    getMetadata(meta.filepath, function (err, data) {
        if (err) {
            next()

            return
        }

        res.setHeader('Content-Type', 'application/x-mpegurl')

        let manifest = getM3U8Header()

        for (let i = 0; i < data.segment_count; i++) {
            manifest += 
            `#EXTINF:${padTime(
                i === data.segment_count - 1?
                data.last_segment_duration :
                data.segment_duration
            )}` + '\n' + id + `/vid_${Number(i)}.ts` + '\n' + '#EXT-X-DISCONTINUITY\n' // FIXME This shouldn't be needed
        }

        manifest += '#EXT-X-ENDLIST'

        meta.id = meta.id || id
        meta.manifest = manifest
        meta.data = data

        res.end(manifest)
    }, Math.ceil(meta.segment_duration || DEFAULT_SEGMENT_DURATION))
}, function (_req, res) {
    res.status(404)
    res.end('not found')
})

// Serve the static deps
app.use(express.static(joinPath(__dirname, './public')))
app.listen(3000)
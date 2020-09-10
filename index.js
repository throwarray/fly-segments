const { join: joinPath } = require('path')

const express = require('express')

const fluent = require('fluent-ffmpeg')

// CHANGE ME!
const { getMeta } = require('./utils.js')
const MEDIA_PATH =  joinPath(__dirname, './media/sp2.avi')
const NUMBER_CPU = require('os').cpus().length


function stripExt (pathname) { return pathname.replace(/\.(.+)$/, '') }

// SERVE
const app = express()

// Master playlist incase it's needed
app.get('/master/:manifest', function (req, res) {
    const manifest_name = req.params.manifest

    res.setHeader('Content-Type', 'application/x-mpegurl')

    res.end(
        '#EXTM3U\n' + 
        '#EXT-X-STREAM-INF:BANDWIDTH=0,AVERAGE-BANDWIDTH=1\n'+
        'http://localhost:3000/streams/' + manifest_name
    )
})

// Generate a manifest with the segment paths
app.get('/streams/:manifest', function (req, res) {
    const segment_duration_sec = 6
    const manifest_name = req.params.manifest
    const media_path = MEDIA_PATH

    console.log('requested manifest', stripExt(manifest_name))

    getMeta(media_path, function (err, data) {
        if (err) {
            res.status(404)
            res.end('not found')

            return
        }

        const { segment_count, segment_duration_sec, duration } = data

        const def = (segment_count * segment_duration_sec) - duration

        const M3U8_SEGMENTS = Array.from({ length: segment_count }, function (v, i) {
            return '#EXTINF:' + Math.round(Number(i === segment_count - 1? 
                segment_duration_sec - def : 
                segment_duration_sec
            )) + '.000,\n' + 'test/segment_' + Number(i) + '.ts' 
           + '\n#EXT-X-DISCONTINUITY' // FIXME This shouldn't be needed
        }).join('\n')

        const M3U8_HEADER = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ALLOW-CACHE:YES\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n'
        const manifest = M3U8_HEADER + 
            '#EXTINF:0.000,\ntest/segment_-1.ts\n' +
            M3U8_SEGMENTS + '\n#EXT-X-ENDLIST'

        res.setHeader('Content-Type', 'application/x-mpegurl')
        res.end(manifest)
    }, segment_duration_sec)
})

// Stream a specific segment
app.get('/streams/:manifest/:segment', function (req, res) {
    const manifest_name = req.params.manifest
    const segment_duration_sec = 6.0
    const segment_name = req.params.segment // segment_0
    const segment_number = Math.round(Number(stripExt(segment_name.split('_')[1]))) || 0

    res.contentType('application/mp2t')

    console.log('segment:', manifest_name, segment_number, segment_duration_sec * Math.max(segment_number, 0) + 's')

    fluent(MEDIA_PATH).outputOptions([
            '-copyts',
            `-ss ${(Math.max(segment_number, 0) * segment_duration_sec) || 0}`,
            `-t ${segment_number < 0? 0.1 : segment_duration_sec}`,
            // '-reset_timestamps 1',
            // '-b:v 500k',
            // '-b:a 128k',
            '-r 30',
            '-maxrate:v 500K',
            '-maxrate:a 128k',
            '-crf 28', //x265=28 and x264=23 51 max
            '-preset veryfast',
            '-tune film', //film|zerolatency
            '-c:v libx264',
            '-x264opts stitchable',
            '-c:a aac',//aac|libmp3lame
            '-force_key_frames', `expr:gte(t,n_forced * ${segment_duration_sec})`,
            '-movflags faststart',//'frag_keyframe+empty_moov+faststart',
            `-f mpegts`,
            '-strict','-2',
            `-threads ${NUMBER_CPU}`,
            

        //'-vf "scale=320:240"',
        //'-flags global_header'
    ])
    .on('start', function(commandLine) {
        // console.log('Spawned Ffmpeg with command: ' + commandLine);
    })
    .on('error', function(err, stdout, stderr) { 
        if (err.message === 'Output stream closed') return

        console.log('cannot process segment:', manifest_name, segment_number, segment_duration_sec * segment_number + 's')
        console.warn(err.message) 
    })
    .pipe(res, { end: true })

    // .on('start', function () {})
    // .on('end', function () {})
    // .on('progress', function(progress) { console.log('Processing: ' + progress.percent + '% done') })
    // .on('kill', function () {})
})

// Serve the static deps
app.use(express.static(joinPath(__dirname, './public')))

// LISTEN
app.listen(3000)

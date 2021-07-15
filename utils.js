const { join: joinPath } = require('path')

const fluent = require('fluent-ffmpeg')

let NUMBER_CPU = require('os').cpus().length

const NOOP = ()=> {}

function getMetadata (filepath, cb = NOOP, segment_duration_sec = 6, count_frames = false) {
    const probe_args = []

    if (count_frames) probe_args.push('-count_frames')

    fluent().input(filepath).ffprobe(0, probe_args, function(err, metadata) {
        if (err || !metadata || !metadata.format) {
            cb(err || new Error('error'))
            return
        }

        const segment_duration = Math.round(Math.abs(segment_duration_sec) || 1)
        const timeStr = metadata.format && metadata.format.duration
        const duration = Math.abs(Number(timeStr) || 1)
        const segment_count = duration === 0 ?
            0:
            Math.ceil(duration / segment_duration) || 1

        // Run with count_frames if duration was N/A. It may take a while.
        if (timeStr === 'N/A' && !count_frames) {
            getMetadata(filepath, cb, segment_duration, true)
            return
        }


        const duration_estimate = segment_count * segment_duration
        const duration_estimate_wrong_by = duration_estimate - duration
        const last_segment_duration = segment_duration - duration_estimate_wrong_by
        
        cb(false, {
            filepath,
            segment_duration,
            timeStr,
            segment_count,
            last_segment_duration,
            duration 
        })
    })
}

function stripExt (pathname) { return pathname.replace(/\.(.+)$/, '') }

function parseContentID (data) { return stripExt(data).replace(/\W+/g, '') }

function padTime (input) {
    const [a, b] = ('' + input).split('.');

    return a + '.' + (b || '').substr(0, 6).padEnd(6, 0)
}




module.exports = {
    stripExt,
    parseContentID,
    padTime,
    getMetadata,
    config ({
        ffmpegPath,
        ffprobePath,
        threads = NUMBER_CPU
    }) {
        NUMBER_CPU = Math.max(1, threads || 1)
        fluent.setFfmpegPath(ffmpegPath || process.env.FFMPEG_PATH || joinPath(__dirname, './ffmpeg.exe'))
        fluent.setFfprobePath(ffprobePath || process.env.FFPROBE_PATH || joinPath(__dirname, './ffprobe.exe'))
    }
}
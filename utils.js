const { join: joinPath } = require('path')

const fluent = require('fluent-ffmpeg')

let NUMBER_CPU = require('os').cpus().length

const NOOP = ()=> {}

function processMeta (filepath, cb = NOOP, segment_duration_sec = 6, count_frames = false) {
    const probe_args = []

    if (count_frames) probe_args.push('-count_frames')

    fluent().input(filepath).ffprobe(0, probe_args, function(err, metadata) {
        if (err || !metadata || !metadata.format) {
            cb(err || new Error('error'))
            return
        }

        const timeStr = metadata.format && metadata.format.duration
        const duration = Number(timeStr) || 1
        const segment_count = Math.ceil(duration / segment_duration_sec) || 1

        // Run with count_frames if duration was N/A. It may take a while.
        if (timeStr === 'N/A' && !count_frames) {
            processMeta(filepath, cb, segment_duration_sec, true)
            return
        }

        cb(false, {
            filepath,
            segment_count,
            segment_duration_sec,
            duration 
        })
    })
}

module.exports = {
    getMeta: processMeta,
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
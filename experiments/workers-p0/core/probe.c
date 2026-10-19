/* Project-owned bounded MP4 admission probe, linked with the GPL media core. */
#include <stdio.h>
#include <math.h>
#include <libavformat/avformat.h>
#include <libavutil/display.h>
#include <libavutil/pixdesc.h>
#include <ft2build.h>
#include FT_FREETYPE_H

int p0_caption(const char *font, const unsigned char *text) {
    FT_Library library;
    FT_Face face;
    if (FT_Init_FreeType(&library)) return -1;
    if (FT_New_Face(library, font, 0, &face)) { FT_Done_FreeType(library); return -1; }
    int missing = 0;
    /* JS supplies validated UTF-8. Keep one face open for the whole caption. */
    while (*text) {
        unsigned long codepoint = *text++;
        int continuation = 0;
        if (codepoint >= 0xF0) { codepoint &= 7; continuation = 3; }
        else if (codepoint >= 0xE0) { codepoint &= 15; continuation = 2; }
        else if (codepoint >= 0xC0) { codepoint &= 31; continuation = 1; }
        while (continuation-- > 0) {
            if ((*text & 0xC0) != 0x80) { missing = -1; break; }
            codepoint = (codepoint << 6) | (*text++ & 0x3F);
        }
        if (missing) break;
        if (codepoint != '\n' && FT_Get_Char_Index(face, codepoint) == 0) { missing = codepoint; break; }
    }
    FT_Done_Face(face);
    FT_Done_FreeType(library);
    return missing;
}

static int reject(AVFormatContext **context, const char *reason) {
    avformat_close_input(context);
    printf("P0_PROBE_ERROR:%s\n", reason);
    return 1;
}

int p0_probe(const char *filename) {
    AVFormatContext *context = NULL;
    AVDictionary *options = NULL;
    av_dict_set(&options, "protocol_whitelist", "file", 0);
    av_dict_set(&options, "probesize", "1048576", 0);
    av_dict_set(&options, "analyzeduration", "1000000", 0);
    int result = avformat_open_input(&context, filename, av_find_input_format("mov"), &options);
    av_dict_free(&options);
    if (result < 0) return reject(&context, "Invalid or damaged MP4");
    AVStream *video = NULL;
    int audio_count = 0;
    for (unsigned i = 0; i < context->nb_streams; i++) {
        AVStream *stream = context->streams[i];
        AVCodecParameters *codec = stream->codecpar;
        if (codec->codec_type == AVMEDIA_TYPE_VIDEO) {
            if (video) return reject(&context, "Exactly one video stream is required");
            video = stream;
            if (codec->codec_id != AV_CODEC_ID_H264) return reject(&context, "Only H.264 video is supported");
            /* Reject oversized declared frames before opening the decoder. */
            if (codec->width <= 0 || codec->height <= 0 || codec->width > 1920 || codec->height > 1920 ||
                (int64_t)codec->width * codec->height > 1920 * 1080)
                return reject(&context, "Input exceeds the tested 1080p pixel budget");
            size_t matrix_size = 0;
            uint8_t *matrix = av_stream_get_side_data(stream, AV_PKT_DATA_DISPLAYMATRIX, &matrix_size);
            if (matrix && matrix_size >= 36 && fabs(av_display_rotation_get((int32_t *)matrix)) > 0.01)
                return reject(&context, "Rotated input requires prior normalization");
        } else if (codec->codec_type == AVMEDIA_TYPE_AUDIO) { audio_count++; stream->discard = AVDISCARD_ALL; }
        else return reject(&context, "Extra data/subtitle streams require prior normalization");
    }
    if (!video) return reject(&context, "Video stream is missing");
    if (audio_count > 2) return reject(&context, "Too many source audio streams");
    if (context->duration <= 0 || context->duration > 60 * AV_TIME_BASE)
        return reject(&context, "Input must have a known duration of at most 60 seconds");
    if (avformat_find_stream_info(context, NULL) < 0) return reject(&context, "Cannot inspect MP4 stream");
    if (video->codecpar->width <= 0 || video->codecpar->height <= 0 || video->codecpar->width > 1920 || video->codecpar->height > 1920 ||
        (int64_t)video->codecpar->width * video->codecpar->height > 1920 * 1080)
        return reject(&context, "Decoded input exceeds the tested 1080p pixel budget");
    const AVPixFmtDescriptor *format = av_pix_fmt_desc_get(video->codecpar->format);
    if (!format || format->comp[0].depth != 8) return reject(&context, "Only 8-bit input is currently supported");
    AVRational rate = av_guess_frame_rate(context, video, NULL);
    double fps = av_q2d(rate);
    if (!isfinite(fps) || fps <= 0 || fps > 60.001) return reject(&context, "Input frame rate must be at most 60 fps");
    double duration = video->duration > 0 ? video->duration * av_q2d(video->time_base) : context->duration / (double)AV_TIME_BASE;
    if (!isfinite(duration) || duration <= 0 || duration > 60) return reject(&context, "Video duration must be at most 60 seconds");
    printf("P0_PROBE:{\"codec\":\"h264\",\"width\":%d,\"height\":%d,\"duration\":%.6f,\"fps\":%.6f,\"audioStreams\":%d,\"pixelFormat\":\"%s\"}\n",
        video->codecpar->width, video->codecpar->height, duration, fps, audio_count, format->name);
    avformat_close_input(&context);
    return 0;
}

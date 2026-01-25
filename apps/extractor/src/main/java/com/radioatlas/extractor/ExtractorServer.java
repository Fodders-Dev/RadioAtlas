package com.radioatlas.extractor;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.StreamingService;
import org.schabi.newpipe.extractor.exceptions.ExtractionException;
import org.schabi.newpipe.extractor.exceptions.ParsingException;
import org.schabi.newpipe.extractor.playlist.PlaylistInfo;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;

public final class ExtractorServer {
  private static final String USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
  private static final Set<String> BLOCKED_HOSTS = Set.of(
      "youtube.com",
      "youtu.be",
      "music.youtube.com",
      "youtube-nocookie.com"
  );
  private static final Gson GSON = new GsonBuilder().serializeNulls().create();

  private ExtractorServer() {
  }

  public static void main(final String[] args) throws Exception {
    final int port = parsePort(System.getenv("PORT"), 4001);
    NewPipe.init(new SimpleDownloader(USER_AGENT));

    final String extractArg = getArgValue(args, "--extract");
    if (extractArg != null && !extractArg.isBlank()) {
      try {
        final ExtractResponse response = extractUrl(extractArg.trim());
        System.out.println(GSON.toJson(response));
      } catch (Exception e) {
        System.out.println(GSON.toJson(ExtractResponse.error(e.getMessage())));
      }
      return;
    }

    final HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/health", ExtractorServer::handleHealth);
    server.createContext("/extract", ExtractorServer::handleExtract);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.start();
    System.out.println("Extractor listening on " + port);
  }

  private static void handleHealth(final HttpExchange exchange) throws IOException {
    sendJson(exchange, 200, Map.of("ok", true));
  }

  private static void handleExtract(final HttpExchange exchange) throws IOException {
    if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
      sendJson(exchange, 405, Map.of("error", "method not allowed"));
      return;
    }

    final String url = getQueryParam(exchange, "url");
    if (url == null || url.isBlank()) {
      sendJson(exchange, 400, Map.of("error", "url is required"));
      return;
    }

    if (isBlocked(url)) {
      sendJson(exchange, 403, Map.of("error", "blocked host"));
      return;
    }

    try {
      sendJson(exchange, 200, extractUrl(url));
    } catch (ExtractionException e) {
      sendJson(exchange, 400, Map.of("error", e.getMessage()));
    } catch (Exception e) {
      sendJson(exchange, 502, Map.of("error", e.getMessage()));
    }
  }

  private static ExtractResponse extractUrl(final String url) throws Exception {
    final StreamingService service = NewPipe.getServiceByUrl(url);
    if (ServiceList.YouTube.getServiceId() == service.getServiceId()) {
      return ExtractResponse.error("youtube blocked");
    }

    StreamingService.LinkType linkType = StreamingService.LinkType.STREAM;
    try {
      linkType = service.getLinkTypeByUrl(url);
    } catch (ParsingException ignored) {
      // fallback to stream extraction
    }

    if (linkType == StreamingService.LinkType.PLAYLIST) {
      final PlaylistInfo playlist = PlaylistInfo.getInfo(service, url);
      final List<ExtractItem> items = new ArrayList<>();
      for (final StreamInfoItem item : playlist.getRelatedItems()) {
        if (items.size() >= 200) break;
        items.add(new ExtractItem(item.getName(), item.getUrl()));
      }
      return ExtractResponse.playlist(
          service.getServiceInfo().getName(),
          url,
          playlist.getName(),
          items
      );
    }

    final StreamInfo info = StreamInfo.getInfo(service, url);
    final List<AudioStream> audioStreams = info.getAudioStreams();
    final List<ExtractAudioStream> audio = new ArrayList<>();
    for (final AudioStream stream : audioStreams) {
      final String content = stream.getContent();
      if (content == null || content.isBlank()) continue;
      final String format = stream.getFormat() != null ? stream.getFormat().getName() : "";
      final String mime = stream.getFormat() != null ? stream.getFormat().getMimeType() : "";
      final String delivery = stream.getDeliveryMethod() != null
          ? stream.getDeliveryMethod().name().toLowerCase(Locale.ROOT)
          : "";
      audio.add(new ExtractAudioStream(
          content,
          format,
          mime,
          stream.getBitrate(),
          stream.getAverageBitrate(),
          delivery
      ));
    }

    audio.sort(Comparator.comparingInt(ExtractorServer::streamRank).reversed());

    return ExtractResponse.stream(
        service.getServiceInfo().getName(),
        url,
        info.getName(),
        info.getUploaderName(),
        info.getDuration(),
        audio
    );
  }

  private static String getArgValue(final String[] args, final String key) {
    for (int i = 0; i < args.length; i += 1) {
      if (key.equals(args[i]) && i + 1 < args.length) {
        return args[i + 1];
      }
    }
    return null;
  }

  private static int streamRank(final ExtractAudioStream stream) {
    final int avg = stream.averageBitrate > 0 ? stream.averageBitrate : 0;
    final int br = stream.bitrate > 0 ? stream.bitrate : 0;
    return Math.max(avg, br);
  }

  private static boolean isBlocked(final String value) {
    try {
      final URL parsed = new URL(value);
      final String host = parsed.getHost().toLowerCase(Locale.ROOT);
      for (final String blocked : BLOCKED_HOSTS) {
        if (host.contains(blocked)) return true;
      }
    } catch (Exception ignored) {
      // ignore invalid url here, will fail later
    }
    return false;
  }

  private static String getQueryParam(final HttpExchange exchange, final String key) {
    final String raw = exchange.getRequestURI().getRawQuery();
    if (raw == null || raw.isEmpty()) return null;
    for (final String part : raw.split("&")) {
      final int idx = part.indexOf('=');
      if (idx < 0) continue;
      final String name = URLDecoder.decode(part.substring(0, idx), StandardCharsets.UTF_8);
      if (!key.equals(name)) continue;
      return URLDecoder.decode(part.substring(idx + 1), StandardCharsets.UTF_8);
    }
    return null;
  }

  private static int parsePort(final String value, final int fallback) {
    if (value == null || value.isBlank()) return fallback;
    try {
      return Integer.parseInt(value.trim());
    } catch (Exception ignored) {
      return fallback;
    }
  }

  private static void sendJson(final HttpExchange exchange, final int status, final Object payload)
      throws IOException {
    final byte[] data = GSON.toJson(payload).getBytes(StandardCharsets.UTF_8);
    final Headers headers = exchange.getResponseHeaders();
    headers.set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, data.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(data);
    }
  }

  private static final class ExtractAudioStream {
    final String url;
    final String format;
    final String mimeType;
    final int bitrate;
    final int averageBitrate;
    final String delivery;

    ExtractAudioStream(final String url,
                       final String format,
                       final String mimeType,
                       final int bitrate,
                       final int averageBitrate,
                       final String delivery) {
      this.url = url;
      this.format = format;
      this.mimeType = mimeType;
      this.bitrate = bitrate;
      this.averageBitrate = averageBitrate;
      this.delivery = delivery;
    }
  }

  private static final class ExtractItem {
    final String title;
    final String url;

    ExtractItem(final String title, final String url) {
      this.title = title;
      this.url = url;
    }
  }

  private static final class ExtractResponse {
    final String type;
    final String service;
    final String url;
    final String title;
    final String uploader;
    final long duration;
    final List<ExtractAudioStream> audioStreams;
    final List<ExtractItem> items;
    final String error;

    private ExtractResponse(final String type,
                            final String service,
                            final String url,
                            final String title,
                            final String uploader,
                            final long duration,
                            final List<ExtractAudioStream> audioStreams,
                            final List<ExtractItem> items,
                            final String error) {
      this.type = type;
      this.service = service;
      this.url = url;
      this.title = title;
      this.uploader = uploader;
      this.duration = duration;
      this.audioStreams = audioStreams;
      this.items = items;
      this.error = error;
    }

    static ExtractResponse stream(final String service,
                                  final String url,
                                  final String title,
                                  final String uploader,
                                  final long duration,
                                  final List<ExtractAudioStream> audioStreams) {
      return new ExtractResponse(
          "stream",
          service,
          url,
          title,
          uploader,
          duration,
          audioStreams,
          List.of(),
          null
      );
    }

    static ExtractResponse playlist(final String service,
                                    final String url,
                                    final String title,
                                    final List<ExtractItem> items) {
      return new ExtractResponse(
          "playlist",
          service,
          url,
          title,
          "",
          0,
          List.of(),
          items,
          null
      );
    }

    static ExtractResponse error(final String message) {
      return new ExtractResponse(
          "error",
          "",
          "",
          "",
          "",
          0,
          List.of(),
          List.of(),
          message
      );
    }
  }
}

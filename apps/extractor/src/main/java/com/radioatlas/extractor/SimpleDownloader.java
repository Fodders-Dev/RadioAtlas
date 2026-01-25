package com.radioatlas.extractor;

import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class SimpleDownloader extends Downloader {
  private final HttpClient client;
  private final String userAgent;

  public SimpleDownloader(final String userAgent) {
    this.userAgent = userAgent;
    this.client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
  }

  @Override
  public Response execute(final Request request)
      throws IOException, ReCaptchaException {
    final String method = request.httpMethod().toUpperCase(Locale.ROOT);
    final byte[] body = request.dataToSend();

    HttpRequest.Builder builder = HttpRequest.newBuilder()
        .uri(URI.create(request.url()))
        .timeout(Duration.ofSeconds(30));

    if ("HEAD".equals(method)) {
      builder = builder.method("HEAD", HttpRequest.BodyPublishers.noBody());
    } else if ("POST".equals(method) || "PUT".equals(method)) {
      builder = builder.method(method,
          body != null ? HttpRequest.BodyPublishers.ofByteArray(body)
              : HttpRequest.BodyPublishers.noBody());
    } else if ("GET".equals(method)) {
      builder = builder.GET();
    } else {
      builder = builder.method(method,
          body != null ? HttpRequest.BodyPublishers.ofByteArray(body)
              : HttpRequest.BodyPublishers.noBody());
    }

    builder.header("User-Agent", userAgent);
    for (final Map.Entry<String, List<String>> entry : request.headers().entrySet()) {
      final String name = entry.getKey();
      if (name == null) continue;
      final List<String> values = entry.getValue();
      if (values == null || values.isEmpty()) continue;
      builder.setHeader(name, values.get(0));
      for (int i = 1; i < values.size(); i += 1) {
        builder.header(name, values.get(i));
      }
    }

    try {
      final HttpResponse<String> response =
          client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 429) {
        throw new ReCaptchaException("Rate limited", request.url());
      }
      return new Response(
          response.statusCode(),
          "",
          response.headers().map(),
          response.body(),
          response.uri().toString()
      );
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IOException("Request interrupted", e);
    }
  }
}

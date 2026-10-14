using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace LyricBridge;

public static partial class LyricImport
{
    private static readonly XNamespace Ttml = "http://www.w3.org/ns/ttml";
    private static void ValidateTtmlProfile(XElement node)
    {
        foreach (var attr in node.Attributes())
        {
            if (attr.Name.LocalName == "timeContainer" && attr.Value != "par" || attr.Name.LocalName == "timeBase" && attr.Value != "media")
                throw Error("unsupported_import_timing", "This import supports absolute lyric timestamps, not sequential, frame/tick or alternate time-base timing.");
        }
        if (node.Name.Namespace == Ttml && node.Name.LocalName is "body" or "div" && node.Attribute("begin") is { } containerBegin && TtmlMilliseconds(containerBegin.Value) != 0)
            throw Error("unsupported_import_timing", "Inherited/container-relative TTML timing is not supported; use explicit absolute paragraph/span timestamps.");
        if (node.Name == Ttml + "span" && node.Attribute("begin") != null && node.Descendants(Ttml + "span").Any(n => n.Attribute("begin") != null))
            throw Error("unsupported_import_timing", "Nested timed spans have unsupported container timing; use leaf spans with absolute timestamps.");
        if (node.Name == Ttml + "span" && node.Attribute("begin") == null && (node.Attribute("end") != null || node.Attribute("dur") != null))
            throw Error("unsupported_import_timing", "A timed span needs an explicit absolute begin timestamp.");
    }
    private static long? TtmlTicks(XElement node, string name) => node.Attribute(name) is { } attribute
        ? checked((long)Math.Round(TtmlMilliseconds(attribute.Value) * 10000d, MidpointRounding.AwayFromZero)) : null;

    private static RichLyrics ParseTtmlDocument(XDocument xml, Candidate candidate, ImportChecks checks, string prefix, CancellationToken token)
    {
        var paragraphs = xml.Descendants(Ttml + "p").Where(p => !string.IsNullOrWhiteSpace(p.Value)).ToList();
        foreach (var p in paragraphs)
            if (p.Attribute("begin") == null && !p.Descendants(Ttml + "span").Any(n => n.Attribute("begin") != null))
                checks.AddError("unsupported_import_timing", "A lyric paragraph needs an explicit absolute begin or a timed span; inherited timing is not supported.", Location(p));
        checks.ThrowIfErrors();
        // Retain existing agent alignment and embedded subtitle/reading metadata. Text and cues
        // are reconstructed below so the permissive provider parser cannot discard fragments.
        var data = Lyricify.Lyrics.Parsers.TtmlParser.Parse(xml.ToString(SaveOptions.DisableFormatting), useEmbeddedSimplifiedChineseLyrics: false);
        var document = Normalization.Parse(new(xml.ToString()), candidate, data);
        if (document.Lines.Count != paragraphs.Count) throw Error("invalid_import_format", "TTML paragraphs could not be parsed completely.");
        for (int index = 0; index < paragraphs.Count; index++)
        {
            token.ThrowIfCancellationRequested();
            var paragraph = paragraphs[index];
            var line = document.Lines[index];
            var background = new LyricLine { Id = line.Id + "-bg", Alignment = line.Alignment };
            var mainText = new StringBuilder(); var bgText = new StringBuilder();
            line.Cues = []; background.Cues = [];
            line.Start = TtmlTicks(paragraph, "begin"); line.End = TtmlTicks(paragraph, "end");
            background.Start = line.Start; background.End = line.End;
            Visit(paragraph.Nodes(), false);
            Finish(line, mainText); Finish(background, bgText);
            if (!string.IsNullOrWhiteSpace(background.Text))
            {
                background.Translations = line.Background?.Translations ?? [];
                background.Pronunciation = line.Background?.Pronunciation;
                line.Background = background;
                checks.Register(background, Location(paragraph) + " / background");
            }
            else line.Background = null;
            checks.Register(line, Location(paragraph));

            void Visit(IEnumerable<XNode> nodes, bool isBackground)
            {
                foreach (var node in nodes)
                {
                    token.ThrowIfCancellationRequested();
                    if (node is XText text) { Append(text.Value, isBackground, paragraph); continue; }
                    if (node is not XElement element) continue;
                    var bg = isBackground || element.Attributes().Any(a => a.Name.LocalName == "role" && a.Value == "x-bg");
                    if (element.Name == Ttml + "br") { Append("\n", bg, element, preserve: true); continue; }
                    if (element.Name != Ttml + "span")
                    {
                        checks.AddError("unsupported_import_format", "Unsupported lyric content element: " + element.Name.LocalName + ".", Location(element)); continue;
                    }
                    if (element.Attribute("begin") == null) { Visit(element.Nodes(), bg); continue; }
                    var target = bg ? background : line;
                    var builder = bg ? bgText : mainText;
                    if (element.Descendants().Any(n => n.Name != Ttml + "span" && n.Name != Ttml + "br") || !bg && element.Descendants().Any(n => n.Attributes().Any(a => a.Name.LocalName == "role" && a.Value == "x-bg")))
                    { checks.AddError("unsupported_import_format", "Timed spans need text/formatting spans with separately attributed background vocals.", Location(element)); continue; }
                    var position = builder.Length;
                    foreach (var inline in element.DescendantNodes())
                    {
                        if (inline is XText value) Append(value.Value, bg, element);
                        else if (inline is XElement br && br.Name == Ttml + "br") Append("\n", bg, br, preserve: true);
                    }
                    var start = TtmlTicks(element, "begin")!.Value;
                    var end = TtmlTicks(element, "end");
                    if (!end.HasValue)
                    {
                        var enclosing = element.Ancestors().Select(a => TtmlTicks(a, "end")).FirstOrDefault(v => v.HasValue);
                        if (enclosing >= start) end = enclosing;
                        if (!end.HasValue) checks.Warn("unresolved_timing", "No explicit span end or applicable enclosing boundary; the word end remains open.", Location(element));
                    }
                    if (builder.Length > position) target.Cues.Add(new(position, builder.Length, start, end));
                    else if (end.HasValue) target.End = Math.Max(target.End ?? end.Value, end.Value);
                }
            }
            void Append(string text, bool bg, XElement element, bool preserve = false)
            {
                var builder = bg ? bgText : mainText;
                var space = element.AncestorsAndSelf().Select(n => n.Attribute(XNamespace.Xml + "space")?.Value).FirstOrDefault(v => v != null);
                if (!preserve && space != "preserve") text = Pattern(@"\s+").Replace(text, " ");
                if (space != "preserve" && builder.Length > 0 && builder[^1] == ' ' && text.StartsWith(' ')) text = text[1..];
                builder.Append(text);
            }
            void Finish(LyricLine target, StringBuilder builder)
            {
                var text = builder.ToString();
                var preserve = paragraph.AncestorsAndSelf().Select(n => n.Attribute(XNamespace.Xml + "space")?.Value).FirstOrDefault(v => v != null) == "preserve";
                var leading = preserve ? 0 : text.Length - text.TrimStart().Length;
                target.Text = preserve ? text : text.Trim();
                target.Cues = target.Cues.Select(c => c with { Position = Math.Clamp(c.Position - leading, 0, target.Text.Length), EndPosition = Math.Clamp(c.EndPosition - leading, 0, target.Text.Length) }).Where(c => c.EndPosition > c.Position).ToList();
                target.Language = Normalization.Detect(target.Text);
                if (target.Start == null && target.Cues.Count > 0) target.Start = target.Cues.Min(c => c.Start);
                int covered = 0; bool untimed = false;
                foreach (var cue in target.Cues)
                {
                    untimed |= target.Text[covered..cue.Position].Any(c => !char.IsWhiteSpace(c));
                    covered = cue.EndPosition;
                }
                untimed |= target.Text[covered..].Any(c => !char.IsWhiteSpace(c));
                if (target.Cues.Count > 0 && untimed)
                    checks.Warn("untimed_text_preserved", "Text outside timed spans was preserved without inventing word timestamps.", Location(paragraph));
            }
        }
        // Every supplied metadata row must reference one original; silently unmatched subtitles
        // and replacements are not a successful complete-file import.
        foreach (var translation in xml.Descendants().Where(n => n.Name.LocalName == "translation"))
        {
            var language = translation.Attribute(XNamespace.Xml + "lang")?.Value;
            var kind = translation.Attribute("type")?.Value;
            foreach (var text in translation.Elements().Where(n => n.Name.LocalName == "text"))
            {
                var key = text.Attribute("for")?.Value;
                var matches = paragraphs.Select((p, i) => (p, i)).Where(pair => pair.p.Attributes().Any(a => a.Name.LocalName == "key" && a.Value == key)).ToList();
                if (matches.Count != 1 || string.IsNullOrWhiteSpace(language) || kind is not ("subtitle" or "replacement"))
                { checks.AddError("invalid_import_format", "Supplied TTML auxiliary text needs a unique original, language and supported subtitle/replacement type.", Location(text)); continue; }
                if (string.IsNullOrWhiteSpace(text.Value)) continue;
                if (kind == "replacement") document.Lines[matches[0].i].Translations[language] = text.Value.Trim();
            }
        }
        checks.ThrowIfErrors();
        return document;
        string Location(XElement node) => prefix + "TTML line " + ((IXmlLineInfo)node).LineNumber + ", column " + ((IXmlLineInfo)node).LinePosition;
    }
}

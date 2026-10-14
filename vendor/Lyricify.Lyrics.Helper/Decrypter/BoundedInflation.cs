using ICSharpCode.SharpZipLib.Zip.Compression.Streams;
namespace Lyricify.Lyrics.Decrypter;

internal static class BoundedInflation
{
    public static byte[] Decode(byte[] compressedBytes, int limit)
    {
        using var compressed = new MemoryStream(compressedBytes);
        using var inflater = new InflaterInputStream(compressed);
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        int count;
        while ((count = inflater.Read(buffer, 0, (int)Math.Min(buffer.Length, (long)limit - output.Length + 1))) != 0)
        {
            if (output.Length + count > limit) throw new InvalidDataException("Decoded lyrics exceed the size limit.");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
}

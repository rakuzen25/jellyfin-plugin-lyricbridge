using ICSharpCode.SharpZipLib.Zip.Compression.Streams;
using System.Text;

namespace Lyricify.Lyrics.Decrypter.Krc
{
    public class Decrypter
    {
        protected readonly static byte[] DecryptKey = { 0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69 };

        /// <summary>
        /// 解密 KRC 歌词
        /// </summary>
        /// <param name="encryptedLyrics">加密的歌词</param>
        /// <returns>解密后的 KRC 歌词</returns>
        public static string? DecryptLyrics(string encryptedLyrics) => DecryptLyrics(Convert.FromBase64String(encryptedLyrics), strictUtf8: false);

        public static string DecryptLyrics(byte[] encryptedLyrics, int maxDecodedBytes = int.MaxValue, bool strictUtf8 = true)
        {
            if (encryptedLyrics.Length < 5 || !encryptedLyrics.AsSpan(0, 4).SequenceEqual(new byte[] { 0x6b, 0x72, 0x63, 0x31 }))
                throw new InvalidDataException("Invalid KRC header.");
            var data = encryptedLyrics[4..];
            for (var i = 0; i < data.Length; i++) data[i] ^= DecryptKey[i % DecryptKey.Length];
            var decoded = BoundedInflation.Decode(data, maxDecodedBytes);
            return new UTF8Encoding(false, strictUtf8).GetString(decoded).TrimStart('\uFEFF');
        }
    }
}

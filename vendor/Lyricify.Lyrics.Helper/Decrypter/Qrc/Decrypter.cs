using ICSharpCode.SharpZipLib.Zip.Compression.Streams;
using System.Text;

namespace Lyricify.Lyrics.Decrypter.Qrc
{
    public class Decrypter
    {
        private readonly static byte[] QQKey = Encoding.ASCII.GetBytes("!@#)(*$%123ZXC!@!@#)(NHL");

        /// <summary>
        /// 解密 QRC 歌词
        /// </summary>
        /// <param name="encryptedLyrics">加密的歌词</param>
        /// <returns>解密后的 QRC 歌词</returns>
        public static string? DecryptLyrics(string encryptedLyrics)
        {
            return DecryptLyrics(HexStringToByteArray(encryptedLyrics), strictUtf8: false);
        }

        public static string DecryptLyrics(byte[] encryptedTextByte, int maxDecodedBytes = int.MaxValue, bool strictUtf8 = true)
        {
            if (encryptedTextByte.Length == 0 || encryptedTextByte.Length % 8 != 0)
                throw new InvalidDataException("Invalid QRC block length.");
            byte[] data = new byte[encryptedTextByte.Length];
            byte[][][] schedule = new byte[3][][];
            for (int i = 0; i < 3; i++)
            {
                schedule[i] = new byte[16][];
                for (int j = 0; j < 16; j++)
                {
                    schedule[i][j] = new byte[6];
                }
            }
            DESHelper.TripleDESKeySetup(QQKey, schedule, DESHelper.DECRYPT);
            var block = new byte[8];
            var decodedBlock = new byte[8];
            for (int i = 0; i < encryptedTextByte.Length; i += 8)
            {
                Array.Copy(encryptedTextByte, i, block, 0, block.Length);
                DESHelper.TripleDESCrypt(block, decodedBlock, schedule);
                Array.Copy(decodedBlock, 0, data, i, decodedBlock.Length);
            }

            var decoded = BoundedInflation.Decode(data, maxDecodedBytes);
            return new UTF8Encoding(false, strictUtf8).GetString(decoded).TrimStart('\uFEFF');
        }
        private static byte[] HexStringToByteArray(string text)
        {
            if (text.Length % 2 != 0) throw new FormatException("Invalid QRC hex length.");
            var data = new byte[text.Length / 2];
            for (int i = 0; i < data.Length; i++) data[i] = Convert.ToByte(text.Substring(i * 2, 2), 16);
            return data;
        }
    }
}

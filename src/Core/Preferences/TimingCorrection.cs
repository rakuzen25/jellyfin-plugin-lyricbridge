using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed record TimingCorrection(string Hash, string Fingerprint, double Seconds);

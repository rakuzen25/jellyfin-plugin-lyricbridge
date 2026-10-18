namespace LyricBridge;

public sealed partial class Store : ILanguageVersionRepository
{
    public bool SaveLocalVariant(Variant variant, long admittedEpoch)
    {
        lock (writeGate)
        {
            if (IsResetting || admittedEpoch != Epoch) return false;
            using var c = Open(); using var tx = c.BeginTransaction();
            if (!CanWrite(c, tx, "variant", variant.Key, variant) || ReadRecord<RichLyrics>(c, tx, "document", variant.Hash) is null) return false;
            WriteUnchecked(c, tx, "variant", variant.Key, variant); tx.Commit(); return true;
        }
    }
    public bool SelectPendingLocal(string choiceId, string key)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var c = Open(); using var tx = c.BeginTransaction(); var selection = new AuxiliarySelection(key);
            if (!CanWrite(c, tx, "auxiliary-choice", choiceId, selection)) return false;
            WriteUnchecked(c, tx, "auxiliary-choice", choiceId, selection); tx.Commit(); return true;
        }
    }
    public bool SaveSuppliedVariant(Variant variant, MixedOrigin origin, string choiceId, Guid? item = null, VersionSnapshot? expected = null)
    {
        if (variant.Origin?.DonorHash != origin.DonorHash) throw new ArgumentException("Variant donor provenance does not match.");
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            if (item is { } itemId && Codec.Serialize(ReadSelection(connection, transaction, itemId.ToString("N"))) != Codec.Serialize(expected)) return false;
            // Both source documents must survive until the reference transaction commits.
            // A native original can be unselected and expire independently of the donor.
            if (ReadRecord<RichLyrics>(connection, transaction, "document", variant.Hash) is null ||
                ReadRecord<RichLyrics>(connection, transaction, "document", origin.DonorHash) is null) return false;
            WriteRecord(connection, transaction, "variant", variant.Key, variant with { OriginType = "supplied" });
            WriteRecord(connection, transaction, "mixed-origin", variant.Key, origin);
            WriteRecord(connection, transaction, "auxiliary-choice", choiceId, new AuxiliarySelection(variant.Key));
            transaction.Commit(); return true;
        }
    }

    public bool SelectAuxiliary(string choiceId, string hash, string kind, string language, string key)
    {
        lock (writeGate)
        {
            if (IsResetting || (operationEpoch.Value is long started && started != Epoch)) return false;
            using var connection = Open(); using var transaction = connection.BeginTransaction();
            if (key is not ("auto" or "provider"))
            {
                var variant = ReadRecord<Variant>(connection, transaction, "variant", key);
                if (variant is null || variant.Hash != hash || variant.Kind != kind ||
                    (kind == "translation" && variant.Language != language && !(variant.Language.StartsWith("zh") && language.StartsWith("zh")))) return false;
            }
            WriteRecord(connection, transaction, "auxiliary-choice", choiceId, new AuxiliarySelection(key));
            transaction.Commit(); return true;
        }
    }
}

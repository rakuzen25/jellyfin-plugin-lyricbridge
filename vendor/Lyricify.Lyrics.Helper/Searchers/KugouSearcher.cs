namespace Lyricify.Lyrics.Searchers
{
    public class KugouSearcher : Searcher, ISearcher
    {
        private readonly Providers.Web.Kugou.Api api;
        public KugouSearcher(Providers.Web.Kugou.Api? api = null) { this.api = api ?? new(); }

        public override string Name => "Kugou";

        public override string DisplayName => "Kugou Music";

        public override Searchers SearcherType => Searchers.Kugou;

        public override async Task<List<ISearchResult>?> SearchForResults(string searchString)
        {
            var search = new List<ISearchResult>();

            try
            {
                var result = await api.GetSearchSong(searchString);
                var results = result?.Data?.Info;
                if (results == null) return null;
                foreach (var track in results)
                {
                    search.Add(new KugouSearchResult(track));
                    if (track.Group is { Count: > 0 } group)
                    {
                        foreach (var subTrack in group)
                        {
                            search.Add(new KugouSearchResult(subTrack));
                        }
                    }
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (HttpRequestException) { throw; }
            catch
            {
                return null;
            }

            return search;
        }
    }
}

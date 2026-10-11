namespace Lyricify.Lyrics.Searchers
{
    public class SodaMusicSearcher : Searcher, ISearcher
    {
        private readonly Providers.Web.SodaMusic.Api api;
        public SodaMusicSearcher(Providers.Web.SodaMusic.Api? api = null) { this.api = api ?? new(); }

        public override string Name => "SodaMusic";

        public override string DisplayName => "Soda Music";

        public override Searchers SearcherType => Searchers.SodaMusic;

        public override async Task<List<ISearchResult>?> SearchForResults(string searchString)
        {
            var search = new List<ISearchResult>();

            try
            {
                var result = await api.Search(searchString);
                var resultDataList = result?.ResultGroups?
                    .Where(group => group?.Data != null)
                    .SelectMany(group => group.Data);
                if (resultDataList == null) return null;

                foreach (var resultData in resultDataList)
                {
                    if (resultData.Meta?.ItemType != "track" || resultData.Entity?.Track == null) continue;
                    search.Add(new SodaMusicSearchResult(resultData));
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

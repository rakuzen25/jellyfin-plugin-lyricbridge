using Lyricify.Lyrics.Providers.Web.QQMusic;

namespace Lyricify.Lyrics.Searchers
{
    public class QQMusicSearcher : Searcher, ISearcher
    {
        private readonly Providers.Web.QQMusic.Api api;
        public QQMusicSearcher(Providers.Web.QQMusic.Api? api = null) { this.api = api ?? new(); }

        public override string Name => "QQ Music";

        public override string DisplayName => "QQ Music";

        public override Searchers SearcherType => Searchers.QQMusic;

        public override async Task<List<ISearchResult>?> SearchForResults(string searchString)
        {
            var search = new List<ISearchResult>();

            try
            {
                var result = await api.Search(searchString, Api.SearchTypeEnum.SONG_ID);
                var results = result?.Req_1?.Data?.Body?.Song?.List;
                if (results == null) return null;
                foreach (var track in results)
                {
                    search.Add(new QQMusicSearchResult(track));
                    if (track.Group is { Count: > 0 } group)
                    {
                        foreach (var subTrack in group)
                        {
                            search.Add(new QQMusicSearchResult(subTrack));
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

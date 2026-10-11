using Lyricify.Lyrics.Providers.Web.Netease;

namespace Lyricify.Lyrics.Searchers
{
    public class NeteaseSearcher : Searcher, ISearcher
    {
        private readonly Providers.Web.Netease.Api api;
        public NeteaseSearcher(Providers.Web.Netease.Api? api = null) { this.api = api ?? new(); }

        public override string Name => "Netease";

        public override string DisplayName => "Netease Cloud Music";

        public override Searchers SearcherType => Searchers.Netease;

        private bool useNewSearchFirst = false;

        public override async Task<List<ISearchResult>?> SearchForResults(string searchString)
        {
            var search = new List<ISearchResult>();

            SearchResult? result = null;
            if (useNewSearchFirst)
            {
                try { result = await api.SearchNew(searchString); }
                catch (OperationCanceledException) { throw; }
                catch (HttpRequestException) { throw; }
                catch
                {
                    useNewSearchFirst = !useNewSearchFirst;
                    try
                    {
                        result = await api.Search(searchString, Api.SearchTypeEnum.SONG_ID);
                        if (result?.Code == -460) throw new Exception();
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (HttpRequestException) { throw; }
                    catch
                    {
                        useNewSearchFirst = !useNewSearchFirst;
                    }
                }
            }
            else
            {
                try
                {
                    result = await api.Search(searchString, Api.SearchTypeEnum.SONG_ID);
                    if (result?.Code == -460) throw new Exception();
                }
                catch (OperationCanceledException) { throw; }
                catch (HttpRequestException) { throw; }
                catch
                {
                    useNewSearchFirst = !useNewSearchFirst;
                    // 尝试新接口，可以在外网使用
                    try { result = await api.SearchNew(searchString); }
                    catch { }
                }
            }

            try
            {
                var results = result?.Result.Songs;
                if (results == null) return null;
                foreach (var track in results)
                {
                    search.Add(new NeteaseSearchResult(track));
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

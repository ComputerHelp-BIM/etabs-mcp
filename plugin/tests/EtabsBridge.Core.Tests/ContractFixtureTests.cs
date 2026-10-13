using System;
using System.IO;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Services;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    /// <summary>
    /// Golden-file tests: the C# serializer output must match contract/fixtures/*.json
    /// byte for byte. The TypeScript client validates the same files against its zod
    /// schemas, so a contract change on either side fails CI until both agree.
    ///
    /// Regenerate after an intentional contract change:
    ///   UPDATE_FIXTURES=1 dotnet test   (then review the diff and bump the version)
    /// </summary>
    public class ContractFixtureTests
    {
        private static string RepoFixturePath(string name)
        {
            // Walk up from bin/... to the repo root (the folder containing /contract).
            DirectoryInfo? dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "contract", "fixtures")))
            {
                dir = dir.Parent;
            }

            if (dir == null)
            {
                throw new InvalidOperationException("contract/fixtures not found above " + AppContext.BaseDirectory);
            }

            return Path.Combine(dir.FullName, "contract", "fixtures", name);
        }

        private static void AssertMatchesFixture(string name, object value)
        {
            string actual = JsonSerializer.Serialize(value) + "\n";
            string path = RepoFixturePath(name);

            if (Environment.GetEnvironmentVariable("UPDATE_FIXTURES") == "1")
            {
                File.WriteAllText(path, actual);
                return;
            }

            Assert.True(File.Exists(path), $"Missing fixture {path}. Run with UPDATE_FIXTURES=1 to create it.");
            Assert.Equal(File.ReadAllText(path).Replace("\r\n", "\n"), actual);
        }

        [Fact]
        public void GeometrySnapshotMatchesContract()
        {
            GeometrySnapshot snapshot = new GeometryService(new FakeEtabsModel(), 1234).GetSnapshot();
            snapshot.Model.BridgeVersion = "0.0.0-fixture"; // keep fixtures stable across releases
            AssertMatchesFixture("geometry.json", snapshot);
        }

        [Fact]
        public void SectionsMatchContract()
        {
            AssertMatchesFixture("sections.json", new SectionService(new FakeEtabsModel()).GetSections());
        }

        [Fact]
        public void LoadsMatchContract()
        {
            AssertMatchesFixture("loads.json", new LoadsService(new FakeEtabsModel()).GetLoads());
        }

        [Fact]
        public void TablesMatchContract()
        {
            var model = new FakeEtabsModel();
            AssertMatchesFixture("tables.json", new TablesResult { Tables = model.GetTables() });

            TableData data = model.GetTable("Story Definitions", "All", Array.Empty<string>());
            data.TotalRows = data.Rows.Count;
            AssertMatchesFixture("table-data.json", data);
        }
    }
}

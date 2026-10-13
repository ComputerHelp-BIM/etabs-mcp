using System;
using System.Collections.Generic;
using System.Linq;
using EtabsBridge.Core;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;

namespace EtabsBridge.Core.Tests.Fakes
{
    /// <summary>
    /// In-memory IEtabsModel: a 2-story, 1x1-bay frame with a slab per floor and one wall.
    /// Stories are returned top-down and include a "Base" entry, mimicking ETABS ordering,
    /// so the service's normalization is exercised.
    /// </summary>
    internal sealed class FakeEtabsModel : IEtabsModel
    {
        public FakeEtabsModel(object? apiRoot = null, Type? apiRootType = null)
        {
            ApiRoot = apiRoot ?? new FakeApi.FakeSapModel();
            ApiRootType = apiRootType ?? typeof(FakeApi.IFakeSapModel);
        }

        public object ApiRoot { get; }

        public Type ApiRootType { get; }

        public int Calls { get; private set; }

        /// <summary>When set, every port method throws this.</summary>
        public Exception? Failure { get; set; }

        public List<TableData> TableContents { get; } = new List<TableData>
        {
            new TableData
            {
                Key = "Story Definitions",
                Version = 1,
                Fields = new[] { "Story", "Height" },
                Rows = new IReadOnlyList<string>[] { new[] { "Story2", "3.5" }, new[] { "Story1", "4" } },
            },
        };

        public RawModelInfo GetModelInfo()
        {
            Touch();
            return new RawModelInfo
            {
                FilePath = @"C:\Models\Sample.EDB",
                EtabsVersion = "22.0.0",
                EtabsVersionNumber = 22.0,
                IsLocked = false,
                UnitsName = "kN_m_C",
            };
        }

        public RawStories GetStories()
        {
            Touch();
            return new RawStories
            {
                BaseElevation = 0,
                Stories = new[]
                {
                    new Story { Name = "Story2", Elevation = 7.5, Height = 3.5, IsMaster = true, Color = "#ff0000" },
                    new Story { Name = "Story1", Elevation = 4, Height = 4, IsMaster = false, SimilarTo = "Story2", Color = "#00ff00" },
                    new Story { Name = "Base", Elevation = 0, Height = 0, Color = "#808080" },
                },
            };
        }

        public IReadOnlyList<GridSystem> GetGridSystems()
        {
            Touch();
            return new[]
            {
                new GridSystem
                {
                    Name = "G1",
                    Type = "Cartesian",
                    XLines = new[] { Line("A", 0), Line("B", 6) },
                    YLines = new[] { Line("1", 0), Line("2", 5) },
                },
            };
        }

        public IReadOnlyList<Joint> GetJoints()
        {
            Touch();
            var joints = new List<Joint>();
            int n = 1;
            foreach (double z in new[] { 0.0, 4.0, 7.5 })
            {
                string story = z == 0 ? "Base" : z == 4 ? "Story1" : "Story2";
                foreach ((double x, double y) in new[] { (0.0, 0.0), (6.0, 0.0), (6.0, 5.0), (0.0, 5.0) })
                {
                    joints.Add(new Joint
                    {
                        Name = n.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        Label = n.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        Story = story,
                        X = x,
                        Y = y,
                        Z = z,
                        Restraints = z == 0 ? new[] { true, true, true, true, true, true } : new bool[6],
                    });
                    n++;
                }
            }

            return joints;
        }

        public IReadOnlyList<FrameMember> GetFrames()
        {
            Touch();
            Dictionary<string, Joint> j = GetJoints().ToDictionary(x => x.Name);
            Calls--; // GetJoints above is an implementation detail of the fake
            FrameMember Frame(string name, string type, string section, string story, string a, string b) => new FrameMember
            {
                Name = name,
                Label = (type == "Column" ? "C" : "B") + name,
                Story = story,
                Section = section,
                Type = type,
                Joint1 = a,
                Joint2 = b,
                Start = new Point3(j[a].X, j[a].Y, j[a].Z),
                End = new Point3(j[b].X, j[b].Y, j[b].Z),
                CardinalPoint = type == "Beam" ? 8 : 10,
            };

            return new[]
            {
                Frame("1", "Column", "C500", "Story1", "1", "5"),
                Frame("2", "Column", "C500", "Story1", "2", "6"),
                Frame("3", "Beam", "B300x600", "Story1", "5", "6"),
                Frame("4", "Column", "C400", "Story2", "5", "9"),
                Frame("5", "Brace", "HSS150", "Story2", "6", "9"),
            };
        }

        public IReadOnlyList<AreaObject> GetAreas()
        {
            Touch();
            return new[]
            {
                new AreaObject { Name = "1", Label = "F1", Story = "Story1", Section = "Slab200", Type = "Floor", Joints = new[] { "5", "6", "7", "8" } },
                new AreaObject { Name = "2", Label = "W1", Story = "Story1", Section = "Wall250", Type = "Wall", Joints = new[] { "3", "4", "8", "7" } },
            };
        }

        public IReadOnlyList<TableInfo> GetTables()
        {
            Touch();
            return new[]
            {
                new TableInfo { Key = "Story Definitions", Name = "Story Definitions", ImportType = 3, IsEmpty = false },
                new TableInfo { Key = "Joint Reactions", Name = "Joint Reactions", ImportType = 0, IsEmpty = true },
            };
        }

        public TableData GetTable(string key, string group, IReadOnlyList<string> fields)
        {
            Touch();
            TableData? source = TableContents.FirstOrDefault(t => t.Key == key);
            if (source == null)
            {
                throw new EtabsApiException("DatabaseTables.GetTableForDisplayArray(" + key + ")", 1);
            }

            return new TableData { Key = source.Key, Version = source.Version, Group = group, Fields = source.Fields, Rows = source.Rows };
        }

        private void Touch()
        {
            Calls++;
            if (Failure != null)
            {
                throw Failure;
            }
        }

        private static GridLine Line(string id, double ordinate) =>
            new GridLine { Id = id, Ordinate = ordinate, Visible = true, BubbleLocation = "End" };
    }
}

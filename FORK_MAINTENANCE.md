# VIOVNL fork maintenance

OfficeNext references this repository as a Git submodule. Keep custom changes on
`main` and merge upstream changes without rewriting the published fork history.

Configure a fresh clone once:

```bash
git remote add upstream https://github.com/blazorblueprintui/ui.git
git fetch upstream
```

Synchronize the fork:

```bash
git checkout main
git pull --ff-only origin main
git fetch upstream
git merge upstream/main
cd src/BlazorBlueprint.Components/build
./install-tailwind.sh
cd ../../..
dotnet build src/BlazorBlueprint.Components/BlazorBlueprint.Components.csproj --configuration Release
git push origin main
```

After pushing, return to OfficeNext, stage the updated `BlazorBlueprint`
submodule pointer, and commit it with the corresponding OfficeNext integration
change. Resolve upstream conflicts in the fork; never replace the submodule with
generated NuGet packages or copy source files into OfficeNext.

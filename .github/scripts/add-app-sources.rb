# Adds Goldstone's own Swift files (local native plugins) to the App target.
# Idempotent — files already in the target are skipped. Elie 10/18/26.
require 'xcodeproj'
path = File.expand_path('../../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
app = project.targets.find { |t| t.name == 'App' } or abort('App target missing')
group = project.main_group.find_subpath('App', false) or abort('App group missing')
added = []
%w[MainViewController.swift TextComposePlugin.swift].each do |f|
  next if app.source_build_phase.files_references.any? { |r| r && r.path == f }
  ref = group.files.find { |r| r.path == f } || group.new_reference(f)
  app.add_file_references([ref])
  added << f
end
project.save
puts added.empty? ? 'App sources already added' : "Added: #{added.join(', ')}"
